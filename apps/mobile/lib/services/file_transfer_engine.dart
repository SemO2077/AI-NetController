import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/material.dart';
import '../protocol/binary_protocol.dart';
import '../theme/fluid_theme.dart';

/// Opcode 0x0C File Transfer Sub-Commands
const int kFileCmdInit = 0x01;
const int kFileCmdChunk = 0x02;
const int kFileCmdFinish = 0x03;
const int kFileCmdAbort = 0x04;

/// Opcode 0x0C Status Responses
const int kFileStatusOk = 0x00;
const int kFileStatusProgress = 0x01;
const int kFileStatusCompleted = 0x02;
const int kFileStatusErrTraversal = 0x10;
const int kFileStatusErrSizeLimit = 0x11;
const int kFileStatusErrChecksum = 0x12;
const int kFileStatusErrIo = 0x13;

const int kFileTransferChunkSize = 64 * 1024; // 64 KB block streaming

enum TransferState {
  idle,
  hashing,
  transferring,
  completed,
  failed,
  cancelled,
}

class TransferProgress {
  final int transferId;
  final String filename;
  final int totalBytes;
  final int bytesSent;
  final double speedBytesPerSec;
  final Duration eta;
  final TransferState state;
  final String? errorMessage;

  const TransferProgress({
    required this.transferId,
    required this.filename,
    required this.totalBytes,
    required this.bytesSent,
    required this.speedBytesPerSec,
    required this.eta,
    required this.state,
    this.errorMessage,
  });

  double get fraction => totalBytes > 0 ? (bytesSent / totalBytes).clamp(0.0, 1.0) : 0.0;
  int get percentage => (fraction * 100).toInt();

  String get speedFormatted {
    if (speedBytesPerSec >= 1024 * 1024) {
      return '${(speedBytesPerSec / (1024 * 1024)).toStringAsFixed(1)} MB/s';
    } else {
      return '${(speedBytesPerSec / 1024).toStringAsFixed(0)} KB/s';
    }
  }
}

/// High-Performance Chunked Encrypted File Transfer Engine
class FileTransferEngine {
  static int _idCounter = 100;
  int _txSeq = 0;
  bool _isCancelled = false;
  VoidCallback? _onCancelWake;

  /// Initiates, chunks, and streams a file to the host over binary sink.
  /// Provide [packetBuilder] (e.g. `client.encryptFrame`) to encrypt chunks
  /// inside an active ChaCha20-Poly1305 AEAD vault session.
  Stream<TransferProgress> sendFile({
    required File file,
    required void Function(Uint8List packet) sendPacket,
    required Stream<ProtocolPacket> ackStream,
    Uint8List Function(int opcode, Uint8List payload)? packetBuilder,
  }) async* {
    _isCancelled = false;
    _idCounter = (_idCounter >= 0x7FFFFFFE) ? 100 : (_idCounter + 1);
    final int transferId = _idCounter;
    Uint8List buildFrame(Uint8List payload) => packetBuilder != null
        ? packetBuilder(BinaryOpcode.fileTransfer, payload)
        : packPacket(BinaryOpcode.fileTransfer, payload, seq: ++_txSeq);

    bool observedHostAck = false;
    bool completedAck = false;
    String? hostError;
    Completer<void>? finishAckWaiter;

    void wakeWaiter() {
      final waiter = finishAckWaiter;
      if (waiter != null && !waiter.isCompleted) {
        waiter.complete();
      }
    }

    _onCancelWake = wakeWaiter;

    final StreamSubscription<ProtocolPacket> ackSub = ackStream.listen(
      (pkt) {
        if (pkt.opcode != BinaryOpcode.fileTransfer || pkt.payload.length < 13) {
          return;
        }
        final bd = ByteData.sublistView(pkt.payload);
        final int ackId = bd.getUint32(0, Endian.big);
        if (ackId != transferId) return;
        observedHostAck = true;
        final int status = bd.getUint8(4);
        final String msg = pkt.payload.length > 13
            ? utf8.decode(pkt.payload.sublist(13), allowMalformed: true).trim()
            : '';
        if (status == kFileStatusCompleted) {
          completedAck = true;
          wakeWaiter();
        } else if (status >= kFileStatusErrTraversal) {
          hostError = msg.isNotEmpty
              ? msg
              : 'Host rejected transfer (status 0x${status.toRadixString(16)})';
          wakeWaiter();
        }
      },
      onError: (Object err) {
        hostError ??= 'Transfer ACK stream error: $err';
        wakeWaiter();
      },
      onDone: () {
        if (!completedAck) {
          hostError ??= 'Connection closed while awaiting transfer ACK.';
          wakeWaiter();
        }
      },
    );

    final String filename = file.uri.pathSegments.isNotEmpty
        ? file.uri.pathSegments.last
        : 'upload_${DateTime.now().millisecondsSinceEpoch}.bin';
    int totalBytes = 0;
    int bytesSent = 0;
    RandomAccessFile? raf;
    final Stopwatch stopwatch = Stopwatch();

    try {
      totalBytes = await file.length();
      yield TransferProgress(
        transferId: transferId,
        filename: filename,
        totalBytes: totalBytes,
        bytesSent: 0,
        speedBytesPerSec: 0,
        eta: Duration.zero,
        state: TransferState.hashing,
      );

      // 1. Calculate SHA-256 Checksum without loading entire file into memory
      final digest = await crypto_pkg.sha256.bind(file.openRead()).first;
      if (_isCancelled) {
        yield TransferProgress(
          transferId: transferId,
          filename: filename,
          totalBytes: totalBytes,
          bytesSent: 0,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.cancelled,
        );
        return;
      }
      final String shaHex = digest.toString();

      // 2. Transmit INIT Packet (Sub-cmd 0x01)
      // Format: [1 cmd][4 id][8 total_size][64 sha256_hex][filename_utf8]
      final Uint8List filenameBytes = utf8.encode(filename);
      final Uint8List initPayload =
          Uint8List(1 + 4 + 8 + 64 + filenameBytes.length);
      final ByteData bdInit = ByteData.sublistView(initPayload);

      bdInit.setUint8(0, kFileCmdInit);
      bdInit.setUint32(1, transferId, Endian.big);
      bdInit.setUint64(5, totalBytes, Endian.big);
      initPayload.setRange(13, 77, ascii.encode(shaHex));
      initPayload.setRange(77, 77 + filenameBytes.length, filenameBytes);

      sendPacket(buildFrame(initPayload)); // 0x0C opcode

      yield TransferProgress(
        transferId: transferId,
        filename: filename,
        totalBytes: totalBytes,
        bytesSent: 0,
        speedBytesPerSec: 0,
        eta: Duration.zero,
        state: TransferState.transferring,
      );

      // 3. Stream 64KB Chunks with Reusable Buffer & Sliding Speed Calculation
      raf = await file.open(mode: FileMode.read);
      stopwatch.start();
      final Uint8List chunkBuf = Uint8List(13 + kFileTransferChunkSize);
      final ByteData bdChunk = ByteData.sublistView(chunkBuf, 0, 13);
      bdChunk.setUint8(0, kFileCmdChunk);
      bdChunk.setUint32(1, transferId, Endian.big);

      while (bytesSent < totalBytes && !_isCancelled && hostError == null) {
        final int remaining = totalBytes - bytesSent;
        final int chunkSize = min(remaining, kFileTransferChunkSize);
        final int readBytes = await raf.readInto(chunkBuf, 13, 13 + chunkSize);
        if (readBytes <= 0) {
          break;
        }

        // Chunk Payload: [1 cmd][4 id][8 offset][chunk_bytes...]
        bdChunk.setUint64(5, bytesSent, Endian.big);
        final Uint8List chunkPayload =
            Uint8List.sublistView(chunkBuf, 0, 13 + readBytes);

        sendPacket(buildFrame(chunkPayload));
        bytesSent += readBytes;

        final double elapsedSec = stopwatch.elapsedMilliseconds / 1000.0;
        final double speed = elapsedSec > 0 ? (bytesSent / elapsedSec) : 0.0;
        final int remainingBytes = totalBytes - bytesSent;
        final double remainingSec = speed > 0 ? (remainingBytes / speed) : 0.0;

        yield TransferProgress(
          transferId: transferId,
          filename: filename,
          totalBytes: totalBytes,
          bytesSent: bytesSent,
          speedBytesPerSec: speed,
          eta: Duration(seconds: remainingSec.toInt()),
          state: TransferState.transferring,
        );

        // Yield slightly to prevent blocking the event loop
        await Future.delayed(const Duration(milliseconds: 1));
      }

      if (hostError != null) {
        yield TransferProgress(
          transferId: transferId,
          filename: filename,
          totalBytes: totalBytes,
          bytesSent: bytesSent,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.failed,
          errorMessage: hostError,
        );
        return;
      }

      if (_isCancelled) {
        // Send ABORT
        final Uint8List abortPayload = Uint8List(5);
        ByteData.sublistView(abortPayload)
          ..setUint8(0, kFileCmdAbort)
          ..setUint32(1, transferId, Endian.big);
        sendPacket(buildFrame(abortPayload));

        yield TransferProgress(
          transferId: transferId,
          filename: filename,
          totalBytes: totalBytes,
          bytesSent: bytesSent,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.cancelled,
        );
        return;
      }

      // 4. Transmit FINISH Packet (Sub-cmd 0x03)
      if (observedHostAck && !completedAck) {
        finishAckWaiter = Completer<void>();
      }
      final Uint8List finishPayload = Uint8List(5);
      ByteData.sublistView(finishPayload)
        ..setUint8(0, kFileCmdFinish)
        ..setUint32(1, transferId, Endian.big);
      sendPacket(buildFrame(finishPayload));

      final pendingWaiter = finishAckWaiter;
      if (pendingWaiter != null) {
        await pendingWaiter.future.timeout(
          const Duration(seconds: 10),
          onTimeout: () {
            hostError ??= 'Timed out awaiting host SHA-256 verification ACK.';
          },
        );
      }

      if (_isCancelled) {
        final Uint8List abortPayload = Uint8List(5);
        ByteData.sublistView(abortPayload)
          ..setUint8(0, kFileCmdAbort)
          ..setUint32(1, transferId, Endian.big);
        sendPacket(buildFrame(abortPayload));

        yield TransferProgress(
          transferId: transferId,
          filename: filename,
          totalBytes: totalBytes,
          bytesSent: bytesSent,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.cancelled,
        );
        return;
      }

      if (hostError != null) {
        yield TransferProgress(
          transferId: transferId,
          filename: filename,
          totalBytes: totalBytes,
          bytesSent: bytesSent,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.failed,
          errorMessage: hostError,
        );
        return;
      }

      final double totalElapsedSec =
          max(stopwatch.elapsedMilliseconds / 1000.0, 0.001);
      yield TransferProgress(
        transferId: transferId,
        filename: filename,
        totalBytes: totalBytes,
        bytesSent: totalBytes,
        speedBytesPerSec:
            totalBytes > 0 ? (totalBytes / totalElapsedSec) : 0.0,
        eta: Duration.zero,
        state: TransferState.completed,
      );
    } catch (e) {
      yield TransferProgress(
        transferId: transferId,
        filename: filename,
        totalBytes: totalBytes,
        bytesSent: bytesSent,
        speedBytesPerSec: 0,
        eta: Duration.zero,
        state: TransferState.failed,
        errorMessage: e.toString(),
      );
    } finally {
      _onCancelWake = null;
      await raf?.close();
      stopwatch.stop();
      await ackSub.cancel();
    }
  }

  void cancel() {
    _isCancelled = true;
    _onCancelWake?.call();
  }
}

/// Circular Progress Dialog with Real-Time Throughput & ETA
class FileTransferProgressDialog extends StatelessWidget {
  final TransferProgress progress;
  final VoidCallback onCancel;

  const FileTransferProgressDialog({
    super.key,
    required this.progress,
    required this.onCancel,
  });

  static String _formatEta(Duration eta) {
    final int totalSec = eta.inSeconds;
    if (totalSec <= 0) return '<1s';
    if (totalSec < 60) return '${totalSec}s';
    final int mins = totalSec ~/ 60;
    final int secs = totalSec % 60;
    return '${mins}m ${secs.toString().padLeft(2, '0')}s';
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final bool isHashing = progress.state == TransferState.hashing;
    final bool isCompleted = progress.state == TransferState.completed;
    final bool isFailed = progress.state == TransferState.failed;
    final bool isCancelled = progress.state == TransferState.cancelled;

    final Color ringColor = isCompleted
        ? palette.success
        : (isFailed || isCancelled)
            ? palette.accent
            : palette.primary;

    final String stateLabel = switch (progress.state) {
      TransferState.hashing => 'HASHING',
      TransferState.transferring => 'TRANSFER',
      TransferState.completed => 'VERIFIED',
      TransferState.failed => 'FAILED',
      TransferState.cancelled => 'CANCELLED',
      TransferState.idle => 'READY',
    };

    return Dialog(
      backgroundColor: palette.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(color: ringColor.withValues(alpha: 0.42)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Circular Indicator with Center Percentage / Status
            SizedBox(
              width: 112,
              height: 112,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 104,
                    height: 104,
                    child: CircularProgressIndicator(
                      value: isHashing ? null : progress.fraction,
                      strokeWidth: 7,
                      backgroundColor: palette.dividerColor,
                      valueColor: AlwaysStoppedAnimation<Color>(ringColor),
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (isCompleted)
                        Icon(
                          Icons.check_rounded,
                          color: palette.success,
                          size: 32,
                        )
                      else if (isFailed || isCancelled)
                        Icon(
                          isFailed
                              ? Icons.error_outline_rounded
                              : Icons.cancel_outlined,
                          color: palette.accent,
                          size: 30,
                        )
                      else
                        Text(
                          isHashing ? 'SHA' : '${progress.percentage}%',
                          style: TextStyle(
                            color: palette.textPrimary,
                            fontSize: isHashing ? 18 : 22,
                            fontWeight: FontWeight.bold,
                            fontFamily: 'monospace',
                          ),
                        ),
                      const SizedBox(height: 2),
                      Text(
                        stateLabel,
                        style: TextStyle(
                          color: (isCompleted || isFailed || isCancelled)
                              ? ringColor
                              : palette.textSecondary,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.2,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),

            // Filename
            Text(
              progress.filename,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: palette.textPrimary,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 8),

            // Speed & ETA or Hashing / Error details
            if (isFailed &&
                progress.errorMessage != null &&
                progress.errorMessage!.trim().isNotEmpty)
              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: palette.accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border:
                      Border.all(color: palette.accent.withValues(alpha: 0.40)),
                ),
                child: Text(
                  progress.errorMessage!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontSize: 11.5,
                    height: 1.35,
                  ),
                ),
              )
            else if (isHashing)
              Text(
                'Computing SHA-256 integrity hash...',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: palette.textSecondary,
                  fontSize: 11.5,
                  fontFamily: 'monospace',
                ),
              )
            else
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    progress.speedFormatted,
                    style: TextStyle(
                      color: palette.success,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'monospace',
                    ),
                  ),
                  Text(' • ', style: TextStyle(color: palette.textTertiary)),
                  Text(
                    isCompleted
                        ? 'SHA-256 OK'
                        : 'ETA: ${_formatEta(progress.eta)}',
                    style: TextStyle(
                      color: palette.textSecondary,
                      fontSize: 12,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
            const SizedBox(height: 22),

            // Action Button
            if (progress.state == TransferState.transferring ||
                progress.state == TransferState.hashing)
              OutlinedButton(
                onPressed: onCancel,
                style: OutlinedButton.styleFrom(
                  foregroundColor: palette.accent,
                  side: BorderSide(color: palette.accent.withValues(alpha: 0.5)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text('CANCEL TRANSFER'),
              )
            else if (isCompleted)
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: palette.success,
                  foregroundColor: palette.isDaylight ? Colors.white : Colors.black,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text('DONE'),
              )
            else
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: palette.accent,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text('CLOSE'),
              ),
          ],
        ),
      ),
    );
  }
}

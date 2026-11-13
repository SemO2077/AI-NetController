import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/material.dart';
import '../protocol/binary_protocol.dart';

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
    final int transferId = ++_idCounter;
    Uint8List buildFrame(Uint8List payload) => packetBuilder != null
        ? packetBuilder(BinaryOpcode.fileTransfer, payload)
        : packPacket(BinaryOpcode.fileTransfer, payload, seq: ++_txSeq);

    bool observedHostAck = false;
    bool completedAck = false;
    String? hostError;
    Completer<void>? finishAckWaiter;

    final StreamSubscription<ProtocolPacket> ackSub = ackStream.listen((pkt) {
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
        final waiter = finishAckWaiter;
        if (waiter != null && !waiter.isCompleted) {
          waiter.complete();
        }
      } else if (status >= kFileStatusErrTraversal) {
        hostError = msg.isNotEmpty
            ? msg
            : 'Host rejected transfer (status 0x${status.toRadixString(16)})';
        final waiter = finishAckWaiter;
        if (waiter != null && !waiter.isCompleted) {
          waiter.complete();
        }
      }
    });

    try {
      final String filename = file.uri.pathSegments.isNotEmpty
          ? file.uri.pathSegments.last
          : 'upload_${DateTime.now().millisecondsSinceEpoch}.bin';

      final int totalBytes = await file.length();
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

      // 3. Stream 64KB Chunks with Sliding Speed Calculation
      final RandomAccessFile raf = await file.open(mode: FileMode.read);
      int bytesSent = 0;
      final Stopwatch stopwatch = Stopwatch()..start();

      try {
        while (bytesSent < totalBytes && !_isCancelled && hostError == null) {
          final int remaining = totalBytes - bytesSent;
          final int chunkSize = min(remaining, kFileTransferChunkSize);
          final Uint8List chunkBytes = await raf.read(chunkSize);

          // Chunk Payload: [1 cmd][4 id][8 offset][chunk_bytes...]
          final Uint8List chunkPayload = Uint8List(1 + 4 + 8 + chunkBytes.length);
          final ByteData bdChunk = ByteData.sublistView(chunkPayload);
          bdChunk.setUint8(0, kFileCmdChunk);
          bdChunk.setUint32(1, transferId, Endian.big);
          bdChunk.setUint64(5, bytesSent, Endian.big);
          chunkPayload.setRange(13, 13 + chunkBytes.length, chunkBytes);

          sendPacket(buildFrame(chunkPayload));
          bytesSent += chunkBytes.length;

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
        await raf.close();
        stopwatch.stop();
      }
    } finally {
      await ackSub.cancel();
    }
  }

  void cancel() {
    _isCancelled = true;
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

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF0A1628),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: const BorderSide(color: Color(0x3300F0FF)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Circular Indicator with Center Percentage
            SizedBox(
              width: 110,
              height: 110,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  CircularProgressIndicator(
                    value: progress.fraction,
                    strokeWidth: 8,
                    backgroundColor: Colors.white10,
                    valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF00F0FF)),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${progress.percentage}%',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          fontFamily: 'monospace',
                        ),
                      ),
                      Text(
                        progress.state == TransferState.hashing
                            ? 'HASHING'
                            : 'TRANSFER',
                        style: const TextStyle(
                          color: Color(0xFF7A93B2),
                          fontSize: 9,
                          letterSpacing: 1.2,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Filename
            Text(
              progress.filename,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 8),

            // Speed & ETA
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  progress.speedFormatted,
                  style: const TextStyle(
                    color: Color(0xFF00FFA3),
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
                const Text(' • ', style: TextStyle(color: Colors.white24)),
                Text(
                  'ETA: ${progress.eta.inSeconds}s',
                  style: const TextStyle(
                    color: Color(0xFF7A93B2),
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Action Button
            if (progress.state == TransferState.transferring ||
                progress.state == TransferState.hashing)
              OutlinedButton(
                onPressed: onCancel,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFF2A6D),
                  side: const BorderSide(color: Color(0x66FF2A6D)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text('CANCEL TRANSFER'),
              )
            else if (progress.state == TransferState.completed)
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00FFA3),
                  foregroundColor: Colors.black,
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
                  backgroundColor: const Color(0xFFFF2A6D),
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

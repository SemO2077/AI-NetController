import 'dart:async';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../protocol/binary_protocol.dart';
import '../security/crypto_engine.dart';

typedef DecryptedFrameCallback = void Function(int seq, Uint8List plaintext);
typedef DroppedFrameCallback = void Function(int droppedSeq);
typedef FrameDecryptErrorCallback = void Function(int seq, String reason);

typedef _DecryptFrameResult = ({
  Uint8List? plaintext,
  String? errorKind,
  int nonceSeq,
});

/// Shared wire-frame AEAD decryption + JPEG SOI/EOI validation used by both
/// the background isolate worker and the synchronous fallback path.
_DecryptFrameResult _decryptAndValidateWireFrame(
  Uint8List rawWirePacket,
  Uint8List recvKey,
  ChaCha20Poly1305Cipher cipher,
) {
  if (rawWirePacket.length < kHeaderSize + kNonceSize + kTagSize) {
    return (plaintext: null, errorKind: 'header', nonceSeq: 0);
  }

  final ProtocolHeader? header = parseHeader(rawWirePacket);
  if (header == null ||
      rawWirePacket.length != kHeaderSize + header.payloadLength ||
      header.opcode != BinaryOpcode.frame ||
      (header.flags & ProtocolFlags.encrypted) == 0 ||
      header.payloadLength < kNonceSize + kTagSize) {
    return (plaintext: null, errorKind: 'header', nonceSeq: 0);
  }

  final ByteData nonceBd = ByteData.sublistView(
    rawWirePacket,
    kHeaderSize,
    kHeaderSize + kNonceSize,
  );
  final int epoch = nonceBd.getUint32(0, Endian.big);
  if (epoch != 0) {
    return (plaintext: null, errorKind: 'header', nonceSeq: 0);
  }
  final int nonceSeq = nonceBd.getUint64(4, Endian.big);

  final Uint8List aad = Uint8List.sublistView(rawWirePacket, 0, kHeaderSize);
  final Uint8List nonce =
      Uint8List.sublistView(rawWirePacket, kHeaderSize, kHeaderSize + kNonceSize);
  final Uint8List ctAndTag =
      Uint8List.sublistView(rawWirePacket, kHeaderSize + kNonceSize);

  final Uint8List? plaintext =
      cipher.decrypt(recvKey, nonce, ctAndTag, aad: aad);
  if (plaintext == null) {
    return (plaintext: null, errorKind: 'aead', nonceSeq: nonceSeq);
  }

  if (plaintext.length < 4 ||
      plaintext[0] != 0xFF ||
      plaintext[1] != 0xD8 ||
      plaintext[plaintext.length - 2] != 0xFF ||
      plaintext[plaintext.length - 1] != 0xD9) {
    return (plaintext: null, errorKind: 'jpeg', nonceSeq: nonceSeq);
  }

  return (plaintext: plaintext, errorKind: null, nonceSeq: nonceSeq);
}

void _frameDecryptWorkerEntry((SendPort, TransferableTypedData) initArgs) {
  final SendPort replyPort = initArgs.$1;
  final Uint8List sessionKey = initArgs.$2.materialize().asUint8List();
  final ChaCha20Poly1305Cipher cipher = ChaCha20Poly1305Cipher();
  final ReceivePort commandPort = ReceivePort();

  replyPort.send(commandPort.sendPort);

  commandPort.listen((dynamic message) {
    if (message == null) {
      zeroize(sessionKey);
      cipher.dispose();
      commandPort.close();
      Isolate.exit();
    }

    if (message is (int, TransferableTypedData)) {
      final int seq = message.$1;
      final Uint8List rawWirePacket = message.$2.materialize().asUint8List();
      final _DecryptFrameResult result = _decryptAndValidateWireFrame(
        rawWirePacket,
        sessionKey,
        cipher,
      );
      if (result.plaintext != null) {
        final TransferableTypedData outTtd =
            TransferableTypedData.fromList(<TypedData>[result.plaintext!]);
        replyPort.send((seq, outTtd));
      } else {
        replyPort.send((seq, result.errorKind ?? 'aead'));
      }
    }
  });
}

/// Persistent off-thread `OP_FRAME` ChaCha20-Poly1305 decrypt + JPEG validator.
///
/// Uses a 1-slot latest-frame-wins overwrite queue when the worker isolate is
/// busy so stale undecrypted video frames never accumulate latency, and reports
/// dropped sequence IDs immediately so the transport can send `OP_FRAME_ACK`
/// and keep backpressure credits flowing. Falls back cleanly to synchronous
/// local decryption while the isolate is spawning or unavailable.
class FrameDecryptIsolate {
  final DecryptedFrameCallback? onFrameDecrypted;
  final DroppedFrameCallback? onFrameDropped;
  final FrameDecryptErrorCallback? onDecryptError;

  final Uint8List _fallbackKey;
  final ChaCha20Poly1305Cipher _fallbackCipher = ChaCha20Poly1305Cipher();
  final Completer<void> _readyCompleter = Completer<void>();

  ReceivePort? _mainReceivePort;
  StreamSubscription<dynamic>? _mainSub;
  ReceivePort? _exitReceivePort;
  StreamSubscription<dynamic>? _exitSub;
  Isolate? _isolate;
  SendPort? _workerSendPort;

  bool _disposed = false;
  bool _isolateUnavailable = false;
  bool _isBusy = false;

  int? _inflightNonceSeq;
  Uint8List? _pendingPacket;
  int? _pendingSeq;
  int? _pendingNonceSeq;
  int _lastVerifiedNonceSeq = 0;

  FrameDecryptIsolate({
    required Uint8List recvKey,
    this.onFrameDecrypted,
    this.onFrameDropped,
    this.onDecryptError,
    bool enableIsolate = true,
  }) : _fallbackKey = Uint8List.fromList(recvKey) {
    if (recvKey.length != kKeySize) {
      zeroize(_fallbackKey);
      throw ArgumentError.value(
        recvKey.length,
        'recvKey',
        'FrameDecryptIsolate requires a 32-byte recv key',
      );
    }

    if (enableIsolate) {
      unawaited(_spawnIsolate());
    } else {
      _isolateUnavailable = true;
      if (!_readyCompleter.isCompleted) {
        _readyCompleter.complete();
      }
    }
  }

  /// Resolves once the background worker handshake finishes (or falls back).
  Future<void> get ready => _readyCompleter.future;

  bool get isIsolateReady =>
      !_disposed && !_isolateUnavailable && _workerSendPort != null;

  bool get isBusy => _isBusy;

  bool get isDisposed => _disposed;

  /// The 64-bit nonce sequence number of the most recently AEAD-verified frame.
  int get lastVerifiedNonceSeq => _lastVerifiedNonceSeq;

  Future<void> _spawnIsolate() async {
    try {
      final ReceivePort receivePort = ReceivePort();
      final ReceivePort exitPort = ReceivePort();
      _mainReceivePort = receivePort;
      _mainSub = receivePort.listen(_handleWorkerMessage);
      _exitReceivePort = exitPort;
      _exitSub = exitPort.listen(_handleWorkerExit);

      final TransferableTypedData keyTransfer =
          TransferableTypedData.fromList(<TypedData>[
        Uint8List.fromList(_fallbackKey),
      ]);

      final Isolate isolate = await Isolate.spawn(
        _frameDecryptWorkerEntry,
        (receivePort.sendPort, keyTransfer),
        onExit: exitPort.sendPort,
        debugName: 'FrameDecryptWorker',
      );

      if (_disposed) {
        isolate.kill(priority: Isolate.immediate);
        return;
      }
      _isolate = isolate;
    } catch (e) {
      debugPrint('[FrameDecryptIsolate] Isolate unavailable, using sync fallback: $e');
      _isolateUnavailable = true;
      unawaited(_mainSub?.cancel());
      _mainSub = null;
      _mainReceivePort?.close();
      _mainReceivePort = null;
      unawaited(_exitSub?.cancel());
      _exitSub = null;
      _exitReceivePort?.close();
      _exitReceivePort = null;
      if (!_readyCompleter.isCompleted) {
        _readyCompleter.complete();
      }
    }
  }

  void _handleWorkerExit(dynamic _) {
    if (_disposed) return;
    // Unexpected worker exit: fall back cleanly to synchronous decryption so
    // the video pipeline can never deadlock with _isBusy stuck true.
    debugPrint('[FrameDecryptIsolate] Worker exited unexpectedly; switching to sync fallback.');
    _isolateUnavailable = true;
    _workerSendPort = null;
    _isolate = null;
    _isBusy = false;
    _inflightNonceSeq = null;
    unawaited(_mainSub?.cancel());
    _mainSub = null;
    _mainReceivePort?.close();
    _mainReceivePort = null;
    unawaited(_exitSub?.cancel());
    _exitSub = null;
    _exitReceivePort?.close();
    _exitReceivePort = null;
    if (!_readyCompleter.isCompleted) {
      _readyCompleter.complete();
    }
    final Uint8List? pendingPkt = _pendingPacket;
    final int? pendingSeq = _pendingSeq;
    _pendingPacket = null;
    _pendingSeq = null;
    _pendingNonceSeq = null;
    if (pendingPkt != null && pendingSeq != null && !_disposed) {
      _decryptSynchronously(pendingPkt, pendingSeq);
    }
  }

  void _handleWorkerMessage(dynamic msg) {
    if (_disposed) {
      if (msg is SendPort) {
        try {
          msg.send(null);
        } catch (_) {}
      }
      return;
    }

    if (msg is SendPort) {
      _workerSendPort = msg;
      if (!_readyCompleter.isCompleted) {
        _readyCompleter.complete();
      }
      return;
    }

    _isBusy = false;
    final int nonceSeq = _inflightNonceSeq ?? 0;
    _inflightNonceSeq = null;

    if (msg is (int, TransferableTypedData)) {
      final int seq = msg.$1;
      final Uint8List plaintext = msg.$2.materialize().asUint8List();
      _lastVerifiedNonceSeq = nonceSeq;
      if (!_disposed) {
        onFrameDecrypted?.call(seq, plaintext);
      }
    } else if (msg is (int, String)) {
      final int seq = msg.$1;
      final String reason = msg.$2;
      if (reason == 'jpeg') {
        _lastVerifiedNonceSeq = nonceSeq;
      }
      if (!_disposed) {
        onDecryptError?.call(seq, reason);
      }
    }

    if (!_disposed && _pendingPacket != null && _workerSendPort != null) {
      final Uint8List nextPkt = _pendingPacket!;
      final int nextSeq = _pendingSeq!;
      final int nextNonceSeq = _pendingNonceSeq ?? 0;
      _pendingPacket = null;
      _pendingSeq = null;
      _pendingNonceSeq = null;
      _isBusy = true;
      _inflightNonceSeq = nextNonceSeq;
      _dispatchToWorker(nextPkt, nextSeq);
    }
  }

  static int _extractNonceSeq(Uint8List rawWirePacket) {
    if (rawWirePacket.length < kHeaderSize + kNonceSize) return 0;
    return ByteData.sublistView(
      rawWirePacket,
      kHeaderSize,
      kHeaderSize + kNonceSize,
    ).getUint64(4, Endian.big);
  }

  void _dispatchToWorker(Uint8List rawWirePacket, int seq) {
    final SendPort? port = _workerSendPort;
    if (port == null || _disposed) return;
    final TransferableTypedData packetTtd =
        TransferableTypedData.fromList(<TypedData>[rawWirePacket]);
    port.send((seq, packetTtd));
  }

  void _decryptSynchronously(Uint8List rawWirePacket, int seq) {
    final _DecryptFrameResult result = _decryptAndValidateWireFrame(
      rawWirePacket,
      _fallbackKey,
      _fallbackCipher,
    );
    if (_disposed) return;

    if (result.plaintext != null) {
      _lastVerifiedNonceSeq = result.nonceSeq;
      onFrameDecrypted?.call(seq, result.plaintext!);
    } else {
      final String err = result.errorKind ?? 'aead';
      if (err == 'jpeg') {
        _lastVerifiedNonceSeq = result.nonceSeq;
      }
      onDecryptError?.call(seq, err);
    }
  }

  /// Enqueues an encrypted `OP_FRAME` wire packet for decryption.
  ///
  /// When the isolate is busy, a newer frame overwrites any pending stale frame
  /// and notifies [onFrameDropped] with the dropped frame's sequence number.
  void enqueueEncryptedFrame(Uint8List rawWirePacket, int seq) {
    if (_disposed) return;

    if (!isIsolateReady) {
      _decryptSynchronously(rawWirePacket, seq);
      return;
    }

    final int nonceSeq = _extractNonceSeq(rawWirePacket);
    if (!_isBusy) {
      _isBusy = true;
      _inflightNonceSeq = nonceSeq;
      _dispatchToWorker(rawWirePacket, seq);
      return;
    }

    if (_pendingPacket != null) {
      final int droppedSeq = _pendingSeq!;
      _pendingPacket = rawWirePacket;
      _pendingSeq = seq;
      _pendingNonceSeq = nonceSeq;
      onFrameDropped?.call(droppedSeq);
    } else {
      _pendingPacket = rawWirePacket;
      _pendingSeq = seq;
      _pendingNonceSeq = nonceSeq;
    }
  }

  /// Stops the background isolate immediately and zeroizes all key material.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _isBusy = false;
    _pendingPacket = null;
    _pendingSeq = null;
    _pendingNonceSeq = null;
    _inflightNonceSeq = null;

    final SendPort? port = _workerSendPort;
    _workerSendPort = null;
    if (port != null) {
      try {
        port.send(null);
      } catch (_) {}
    } else {
      _isolate?.kill(priority: Isolate.immediate);
    }
    _isolate = null;

    unawaited(_mainSub?.cancel());
    _mainSub = null;
    _mainReceivePort?.close();
    _mainReceivePort = null;
    unawaited(_exitSub?.cancel());
    _exitSub = null;
    _exitReceivePort?.close();
    _exitReceivePort = null;

    zeroize(_fallbackKey);
    _fallbackCipher.dispose();

    if (!_readyCompleter.isCompleted) {
      _readyCompleter.complete();
    }
  }
}

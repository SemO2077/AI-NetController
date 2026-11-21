import 'dart:async';
import 'dart:typed_data';

import 'binary_protocol.dart' as bp;
import 'fragmentation_engine.dart'
    show FragmentAssemblySession, kFragmentHeaderSize;

/// High-Performance Zero-Allocation Binary Wire Protocol Framer & Reassembler
/// ============================================================================
/// Protocol Framing Specification (Canonical AI NetController 12B Header):
/// [0xC5, 0x71]  - 2B Sync Magic Header
/// [Opcode]      - 1B Command / Packet Type
/// [Flags]       - 1B Bitmask (0x01: Compressed, 0x02: Encrypted, 0x04: Fragmented, 0x08: Last Fragment)
/// [Seq]         - 4B Big-Endian Monotonic Sequence Number
/// [Length]      - 4B Big-Endian Payload Byte Length
/// Total Header  = 12 Bytes
///
/// Fragmentation Sub-Header (When Flag 0x04 is set):
/// [Message ID]  - 4B Unique Multi-Packet Message ID
/// [Offset]      - 4B Byte Offset in Target Buffer
/// [Total Length]- 4B Reassembled Message Total Byte Length
/// Total Sub-Hdr = 12 Bytes
/// ============================================================================

const int kSyncByte0 = bp.kMagicByte0;
const int kSyncByte1 = bp.kMagicByte1;
const int kHeaderLength = bp.kHeaderSize;
const int kFragSubHeaderLength = kFragmentHeaderSize;
const int kMaxPayloadSize = bp.kMaxPayloadSize;

// Protocol Flags
class WireFlags {
  static const int none = bp.ProtocolFlags.none;
  static const int compressed = bp.ProtocolFlags.compressed;
  static const int encrypted = bp.ProtocolFlags.encrypted;
  static const int fragmented = bp.ProtocolFlags.isFragmented;
  static const int lastFragment = bp.ProtocolFlags.isLastFragment;
}

class WirePacket {
  final int opcode;
  final int flags;
  final int seq;
  final Uint8List payload;

  const WirePacket({
    required this.opcode,
    required this.flags,
    required this.seq,
    required this.payload,
  });
}

class NetworkFramer {
  // Pre-allocated ring accumulator to prevent GC thrashing during 60 FPS streaming
  static const int kInitialAccumulatorCapacity = 512 * 1024; // 512 KB
  static const int _maxActiveSessions = 32;
  static const int _maxTotalBufferedBytes = 32 * 1024 * 1024;

  Uint8List _accumulator = Uint8List(kInitialAccumulatorCapacity);
  int _writeIndex = 0;
  int _readIndex = 0;
  bool _disposed = false;

  // Reassembly Session Cache ((opcode, messageId) -> Shared Assembly Session)
  final Map<(int, int), FragmentAssemblySession> _fragmentSessions = {};
  final Duration fragmentTimeout;
  Timer? _reaperTimer;

  final StreamController<WirePacket> _packetStreamController =
      StreamController<WirePacket>.broadcast(sync: true);

  Stream<WirePacket> get onPacket => _packetStreamController.stream;

  NetworkFramer({this.fragmentTimeout = const Duration(seconds: 4)});

  void _ensureReaperTimer() {
    if (_disposed || _reaperTimer != null || _fragmentSessions.isEmpty) return;
    // Background reaper for dropped / timed-out fragmented packets
    _reaperTimer = Timer.periodic(
        const Duration(seconds: 2), (_) => _reapExpiredSessions());
  }

  void _stopReaperTimerIfIdle() {
    if (_fragmentSessions.isEmpty) {
      _reaperTimer?.cancel();
      _reaperTimer = null;
    }
  }

  /// Pushes raw chunks received from the TCP or WebSocket stream
  void pushChunk(Uint8List chunk) {
    if (_disposed || chunk.isEmpty) return;
    _ensureAccumulatorCapacity(chunk.length);

    // Copy chunk into accumulator without unnecessary allocations
    _accumulator.setRange(_writeIndex, _writeIndex + chunk.length, chunk);
    _writeIndex += chunk.length;

    _processAccumulator();
  }

  void _ensureAccumulatorCapacity(int incomingBytes) {
    final int available = _accumulator.length - _writeIndex;
    if (available >= incomingBytes) return;

    final int unreadBytes = _writeIndex - _readIndex;
    if (unreadBytes + incomingBytes <= _accumulator.length) {
      // Shift unread bytes to start of buffer in-place without allocating a sublist copy
      if (unreadBytes > 0) {
        _accumulator.setRange(0, unreadBytes, _accumulator, _readIndex);
      }
      _readIndex = 0;
      _writeIndex = unreadBytes;
    } else {
      // Expand buffer (doubling size)
      final int newCapacity = (_accumulator.length * 2) + incomingBytes;
      final Uint8List newBuf = Uint8List(newCapacity);
      if (unreadBytes > 0) {
        newBuf.setRange(0, unreadBytes, _accumulator, _readIndex);
      }
      _accumulator = newBuf;
      _readIndex = 0;
      _writeIndex = unreadBytes;
    }
  }

  void _processAccumulator() {
    while ((_writeIndex - _readIndex) >= kHeaderLength) {
      // 1. Frame Resynchronization & Header Decode via Canonical Parser
      final bp.ProtocolHeader? header =
          bp.parseHeader(_accumulator, offset: _readIndex);
      if (header == null) {
        // Invalid magic or oversized corrupted length: discard 1 byte and resynchronize
        _readIndex++;
        continue;
      }

      final int totalFrameSize = kHeaderLength + header.payloadLength;
      if ((_writeIndex - _readIndex) < totalFrameSize) {
        // Incomplete frame; wait for subsequent TCP chunks
        break;
      }

      // Complete frame available
      final int payloadStart = _readIndex + kHeaderLength;
      final int payloadEnd = payloadStart + header.payloadLength;
      final Uint8List rawPayload = _accumulator.sublist(payloadStart, payloadEnd);

      _readIndex += totalFrameSize;

      // Check if sub-MTU fragment reassembly is required
      if ((header.flags & WireFlags.fragmented) != 0) {
        _handleFragment(header.opcode, header.flags, header.seq, rawPayload);
      } else if (!_packetStreamController.isClosed) {
        // Direct unfragmented packet
        _packetStreamController.add(WirePacket(
          opcode: header.opcode,
          flags: header.flags,
          seq: header.seq,
          payload: rawPayload,
        ));
      }
    }

    // Compact buffer if all bytes processed, and reclaim oversized transient buffers
    if (_readIndex == _writeIndex) {
      _readIndex = 0;
      _writeIndex = 0;
      if (_accumulator.length > kInitialAccumulatorCapacity * 4) {
        _accumulator = Uint8List(kInitialAccumulatorCapacity);
      }
    }
  }

  void _handleFragment(
      int opcode, int flags, int seq, Uint8List fragmentPayload) {
    if (fragmentPayload.length < kFragSubHeaderLength) return;

    final ByteData bd =
        ByteData.sublistView(fragmentPayload, 0, kFragSubHeaderLength);
    final int messageId = bd.getUint32(0, Endian.big);
    final int offset = bd.getUint32(4, Endian.big);
    final int totalLength = bd.getUint32(8, Endian.big);

    // Guard against forged/malicious fragment totalLength causing OOM (max 10 MiB/msg, 32 MiB total, max 32 sessions)
    if (totalLength <= 0 || totalLength > kMaxPayloadSize) return;
    final int sliceLen = fragmentPayload.length - kFragSubHeaderLength;
    if (offset < 0 || sliceLen <= 0 || offset + sliceLen > totalLength) return;

    final (int, int) sessionKey = (opcode, messageId);
    if (!_fragmentSessions.containsKey(sessionKey)) {
      int totalBufferedBytes = _fragmentSessions.values.fold<int>(
        0,
        (sum, s) => sum + s.totalLength,
      );
      if (_fragmentSessions.length >= _maxActiveSessions ||
          totalBufferedBytes + totalLength > _maxTotalBufferedBytes) {
        _reapExpiredSessions();
        totalBufferedBytes = _fragmentSessions.values.fold<int>(
          0,
          (sum, s) => sum + s.totalLength,
        );
        while (_fragmentSessions.isNotEmpty &&
            (_fragmentSessions.length >= _maxActiveSessions ||
                totalBufferedBytes + totalLength > _maxTotalBufferedBytes)) {
          final removed = _fragmentSessions.remove(_fragmentSessions.keys.first);
          if (removed != null) {
            totalBufferedBytes -= removed.totalLength;
          }
        }
      }
    }

    final Uint8List slice =
        Uint8List.sublistView(fragmentPayload, kFragSubHeaderLength);

    final FragmentAssemblySession session = _fragmentSessions.putIfAbsent(
      sessionKey,
      () => FragmentAssemblySession(
        messageId: messageId,
        totalLength: totalLength,
        opcode: opcode,
        baseFlags: flags & ~(WireFlags.fragmented | WireFlags.lastFragment),
        baseSeq: seq,
      ),
    );
    _ensureReaperTimer();

    if (session.totalLength != totalLength || session.opcode != opcode) {
      return;
    }

    session.addChunk(offset, slice);

    // Check completion condition across contiguous interval [0, totalLength)
    if (session.isComplete) {
      _fragmentSessions.remove(sessionKey);
      _stopReaperTimerIfIdle();
      if (!_packetStreamController.isClosed) {
        _packetStreamController.add(WirePacket(
          opcode: session.opcode,
          flags: session.baseFlags,
          seq: session.baseSeq,
          payload: session.buffer,
        ));
      }
    }
  }

  void _reapExpiredSessions() {
    final now = DateTime.now();
    _fragmentSessions.removeWhere((id, session) =>
        now.difference(session.lastActivity) > fragmentTimeout);
    _stopReaperTimerIfIdle();
  }

  void dispose() {
    _disposed = true;
    _reaperTimer?.cancel();
    _reaperTimer = null;
    unawaited(_packetStreamController.close());
    _fragmentSessions.clear();
  }
}

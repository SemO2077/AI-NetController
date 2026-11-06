import 'dart:async';
import 'dart:typed_data';

/// High-Performance Zero-Allocation Binary Wire Protocol Framer & Reassembler
/// ============================================================================
/// Protocol Framing Specification:
/// [0x55, 0xAA]  - 2B Sync Magic Header
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

const int kSyncByte0 = 0x55;
const int kSyncByte1 = 0xAA;
const int kHeaderLength = 12;
const int kFragSubHeaderLength = 12;

// Protocol Flags
class WireFlags {
  static const int none = 0x00;
  static const int compressed = 0x01;
  static const int encrypted = 0x02;
  static const int fragmented = 0x04;
  static const int lastFragment = 0x08;
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

class _FragmentAssemblySession {
  final int messageId;
  final int totalLength;
  final int opcode;
  final int flags;
  final int seq;
  final Uint8List buffer;
  int bytesReceived = 0;
  DateTime lastActivity;

  _FragmentAssemblySession({
    required this.messageId,
    required this.totalLength,
    required this.opcode,
    required this.flags,
    required this.seq,
  })  : buffer = Uint8List(totalLength),
        lastActivity = DateTime.now();
}

class NetworkFramer {
  // Pre-allocated ring accumulator to prevent GC thrashing during 60 FPS streaming
  static const int kInitialAccumulatorCapacity = 512 * 1024; // 512 KB
  Uint8List _accumulator = Uint8List(kInitialAccumulatorCapacity);
  int _writeIndex = 0;
  int _readIndex = 0;

  // Reassembly Session Cache (Message ID -> Assembly Session)
  final Map<int, _FragmentAssemblySession> _fragmentSessions = {};
  final Duration fragmentTimeout;
  Timer? _reaperTimer;

  final StreamController<WirePacket> _packetStreamController =
      StreamController<WirePacket>.broadcast();

  Stream<WirePacket> get onPacket => _packetStreamController.stream;

  NetworkFramer({this.fragmentTimeout = const Duration(seconds: 4)}) {
    // Background reaper for dropped / timed-out fragmented packets
    _reaperTimer = Timer.periodic(const Duration(seconds: 2), (_) => _reapExpiredSessions());
  }

  /// Pushes raw chunks received from the TCP or WebSocket stream
  void pushChunk(Uint8List chunk) {
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
      // 1. Frame Resynchronization: Verify 0x55, 0xAA or 0xC5, 0x71 Magic Header
      final int b0 = _accumulator[_readIndex];
      final int b1 = _accumulator[_readIndex + 1];
      final bool isSyncHeader =
          (b0 == kSyncByte0 && b1 == kSyncByte1) || (b0 == 0xC5 && b1 == 0x71);
      if (!isSyncHeader) {
        // Discard 1 byte and resynchronize
        _readIndex++;
        continue;
      }

      final ByteData bd = ByteData.sublistView(_accumulator, _readIndex, _readIndex + kHeaderLength);
      final int opcode = bd.getUint8(2);
      final int flags = bd.getUint8(3);
      final int seq = bd.getUint32(4, Endian.big);
      final int payloadLen = bd.getUint32(8, Endian.big);

      // Sanity check length against safety ceiling (16MB)
      if (payloadLen > 16 * 1024 * 1024) {
        // Desynchronized corrupted length header: advance 1 byte
        _readIndex++;
        continue;
      }

      final int totalFrameSize = kHeaderLength + payloadLen;
      if ((_writeIndex - _readIndex) < totalFrameSize) {
        // Incomplete frame; wait for subsequent TCP chunks
        break;
      }

      // Complete frame available
      final int payloadStart = _readIndex + kHeaderLength;
      final int payloadEnd = payloadStart + payloadLen;
      final Uint8List rawPayload = _accumulator.sublist(payloadStart, payloadEnd);

      _readIndex += totalFrameSize;

      // Check if sub-MTU fragment reassembly is required
      if ((flags & WireFlags.fragmented) != 0) {
        _handleFragment(opcode, flags, seq, rawPayload);
      } else {
        // Direct unfragmented packet
        _packetStreamController.add(WirePacket(
          opcode: opcode,
          flags: flags,
          seq: seq,
          payload: rawPayload,
        ));
      }
    }

    // Compact buffer if all bytes processed
    if (_readIndex == _writeIndex) {
      _readIndex = 0;
      _writeIndex = 0;
    }
  }

  void _handleFragment(int opcode, int flags, int seq, Uint8List fragmentPayload) {
    if (fragmentPayload.length < kFragSubHeaderLength) return;

    final ByteData bd = ByteData.sublistView(fragmentPayload, 0, kFragSubHeaderLength);
    final int messageId = bd.getUint32(0, Endian.big);
    final int offset = bd.getUint32(4, Endian.big);
    final int totalLength = bd.getUint32(8, Endian.big);

    // Guard against forged/malicious fragment totalLength causing OOM (max 16 MB, max 32 active sessions)
    if (totalLength <= 0 || totalLength > 16 * 1024 * 1024) return;
    if (!_fragmentSessions.containsKey(messageId) && _fragmentSessions.length >= 32) {
      _reapExpiredSessions();
      if (_fragmentSessions.length >= 32) {
        _fragmentSessions.remove(_fragmentSessions.keys.first);
      }
    }

    final int sliceLen = fragmentPayload.length - kFragSubHeaderLength;
    if (offset < 0 || offset + sliceLen > totalLength) return;

    final Uint8List slice =
        Uint8List.sublistView(fragmentPayload, kFragSubHeaderLength);

    _FragmentAssemblySession session = _fragmentSessions.putIfAbsent(
      messageId,
      () => _FragmentAssemblySession(
        messageId: messageId,
        totalLength: totalLength,
        opcode: opcode,
        flags: flags & ~(WireFlags.fragmented | WireFlags.lastFragment),
        seq: seq,
      ),
    );

    if (offset + slice.length <= session.totalLength) {
      session.buffer.setRange(offset, offset + slice.length, slice);
      session.bytesReceived += slice.length;
      session.lastActivity = DateTime.now();
    }

    // Check completion condition
    if (session.bytesReceived >= session.totalLength) {
      _fragmentSessions.remove(messageId);
      _packetStreamController.add(WirePacket(
        opcode: session.opcode,
        flags: session.flags,
        seq: session.seq,
        payload: session.buffer,
      ));
    }
  }

  void _reapExpiredSessions() {
    final now = DateTime.now();
    _fragmentSessions.removeWhere((id, session) {
      final expired = now.difference(session.lastActivity) > fragmentTimeout;
      return expired;
    });
  }

  void dispose() {
    _reaperTimer?.cancel();
    _packetStreamController.close();
    _fragmentSessions.clear();
  }
}

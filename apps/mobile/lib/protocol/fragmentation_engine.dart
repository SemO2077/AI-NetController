import 'dart:async';
import 'dart:typed_data';
import 'binary_protocol.dart';

/// Network Edge-Case & Sub-MTU Application-Layer Fragmentation Engine
/// ---------------------------------------------------------------------
/// Eliminates TCP Head-of-Line Blocking and WebSocket Frame Buffer Overflow
/// when transmitting high-resolution 60 FPS JPEG desktop streams (up to 4MB)
/// across lossy or congested 802.11 Wi-Fi networks.

// Protocol Flag bit masks
const int kFlagCompressed = 0x01; // Bit 0: Gzip / Zlib Compressed
const int kFlagEncrypted = 0x02; // Bit 1: ChaCha20-Poly1305 AEAD
const int kFlagIsFragmented = 0x04; // Bit 2: Sub-MTU Chunked Packet
const int kFlagIsLastFragment = 0x08; // Bit 3: Terminal Chunk of Message

// Fragmentation sub-header size in bytes:
// [4 bytes Message ID] + [4 bytes Fragment Offset] + [4 bytes Total Message Length]
const int kFragmentHeaderSize = 12;

// Default chunk threshold: 64 KB (65,536 bytes)
const int kDefaultMaxChunkSize = 64 * 1024;

// Session TTL: incomplete chunks purged after 5 seconds
const Duration kFragmentSessionTtl = Duration(seconds: 5);

/// Representation of a single parsed fragment chunk
class PacketFragment {
  final int opcode;
  final int flags;
  final int seq;
  final int messageId;
  final int fragmentOffset;
  final int totalLength;
  final bool isLast;
  final Uint8List chunkPayload;

  const PacketFragment({
    required this.opcode,
    required this.flags,
    required this.seq,
    required this.messageId,
    required this.fragmentOffset,
    required this.totalLength,
    required this.isLast,
    required this.chunkPayload,
  });
}

/// In-memory reassembly session for a multi-chunk binary message
class _AssemblySession {
  final int messageId;
  final int opcode;
  final int totalLength;
  final int baseFlags;
  final int baseSeq;
  final Uint8List buffer;
  final Set<int> receivedOffsets;
  int bytesAccumulated;
  DateTime lastActivity;

  _AssemblySession({
    required this.messageId,
    required this.opcode,
    required this.totalLength,
    required this.baseFlags,
    required this.baseSeq,
  })  : buffer = Uint8List(totalLength),
        receivedOffsets = <int>{},
        bytesAccumulated = 0,
        lastActivity = DateTime.now();

  bool get isComplete => bytesAccumulated >= totalLength;
}

/// Slices oversized binary frames (e.g. 2MB JPEG frames) into sub-64KB chunks
class PacketFragmenter {
  static int _nextMessageId = 1000;

  /// Fragments an arbitrary payload into a list of framed packets
  static List<Uint8List> slice({
    required int opcode,
    required Uint8List payload,
    int maxChunkSize = kDefaultMaxChunkSize,
    int flags = 0,
    int seq = 0,
  }) {
    // If payload is already under threshold, send as single unfragmented packet
    if (payload.length <= maxChunkSize) {
      return [packPacket(opcode, payload, flags: flags, seq: seq)];
    }

    final int messageId = ++_nextMessageId;
    final int totalLength = payload.length;
    final List<Uint8List> packets = [];

    int offset = 0;
    while (offset < totalLength) {
      final int chunkSize = (offset + maxChunkSize > totalLength)
          ? totalLength - offset
          : maxChunkSize;
      final bool isLast = (offset + chunkSize >= totalLength);

      final int fragmentFlags =
          flags | kFlagIsFragmented | (isLast ? kFlagIsLastFragment : 0);
      final int packetPayloadLength = kFragmentHeaderSize + chunkSize;

      final Uint8List framedPacket =
          Uint8List(kHeaderSize + packetPayloadLength);
      final ByteData bd = ByteData.sublistView(framedPacket);

      // Base 12-byte header
      bd.setUint8(0, kMagicByte0);
      bd.setUint8(1, kMagicByte1);
      bd.setUint8(2, opcode);
      bd.setUint8(3, fragmentFlags);
      bd.setUint32(4, seq, Endian.big);
      bd.setUint32(8, packetPayloadLength, Endian.big);

      // 12-byte Fragmentation Sub-Header
      bd.setUint32(kHeaderSize + 0, messageId, Endian.big);
      bd.setUint32(kHeaderSize + 4, offset, Endian.big);
      bd.setUint32(kHeaderSize + 8, totalLength, Endian.big);

      // Chunk Payload (Zero-allocation view copy)
      framedPacket.setRange(
        kHeaderSize + kFragmentHeaderSize,
        kHeaderSize + packetPayloadLength,
        payload,
        offset,
      );

      packets.add(framedPacket);
      offset += chunkSize;
    }

    return packets;
  }
}

/// Reassembles streaming fragmented chunks into complete ProtocolPackets
class PacketReassembler {
  final Map<int, _AssemblySession> _sessions = {};
  final StreamController<ProtocolPacket> _completePacketStream =
      StreamController<ProtocolPacket>.broadcast();
  final StreamController<int> _frameSyncRequestStream =
      StreamController<int>.broadcast();
  Timer? _cleanupTimer;
  int _lastVideoMessageId = 0;

  Stream<ProtocolPacket> get onPacketReassembled =>
      _completePacketStream.stream;
  Stream<int> get onFrameSyncRequested => _frameSyncRequestStream.stream;

  PacketReassembler() {
    // Periodic garbage collection for aborted transmissions (tightened to 1s for fast keyframe recovery)
    _cleanupTimer = Timer.periodic(
        const Duration(seconds: 1), (_) => _purgeStaleSessions());
  }

  /// Ingests a raw network buffer. Returns the reassembled [ProtocolPacket]
  /// if this chunk completed a message, or if it was an unfragmented packet.
  ProtocolPacket? ingestBytes(Uint8List rawBytes) {
    if (rawBytes.length < kHeaderSize) return null;

    final ByteData bd = ByteData.sublistView(rawBytes);
    final int m0 = bd.getUint8(0);
    final int m1 = bd.getUint8(1);
    if (m0 != kMagicByte0 || m1 != kMagicByte1) return null;

    final int opcode = bd.getUint8(2);
    final int flags = bd.getUint8(3);
    final int seq = bd.getUint32(4, Endian.big);
    final int payloadLength = bd.getUint32(8, Endian.big);

    if (payloadLength > 16 * 1024 * 1024 ||
        rawBytes.length < kHeaderSize + payloadLength) {
      return null;
    }

    final bool isFragmented = (flags & kFlagIsFragmented) != 0;

    // Fast-path: Unfragmented packet
    if (!isFragmented) {
      return ProtocolPacket(
        opcode: opcode,
        flags: flags,
        seq: seq,
        payload: rawBytes.sublist(kHeaderSize, kHeaderSize + payloadLength),
      );
    }

    // Fragmented packet: Extract fragmentation sub-header
    if (payloadLength < kFragmentHeaderSize) return null;

    final int messageId = bd.getUint32(kHeaderSize + 0, Endian.big);
    final int offset = bd.getUint32(kHeaderSize + 4, Endian.big);
    final int totalLength = bd.getUint32(kHeaderSize + 8, Endian.big);
    final int chunkBytesLength = payloadLength - kFragmentHeaderSize;

    // Guard against forged/corrupted fragment headers causing OOM
    if (totalLength <= 0 ||
        totalLength > 16 * 1024 * 1024 ||
        offset < 0 ||
        offset + chunkBytesLength > totalLength) {
      return null;
    }

    if (!_sessions.containsKey(messageId) && _sessions.length >= 32) {
      _purgeStaleSessions();
      if (_sessions.length >= 32) {
        _sessions.remove(_sessions.keys.first);
      }
    }

    // Detect skipped frame in video stream (Opcode 0x03)
    if (opcode == BinaryOpcode.frame) {
      if (messageId > _lastVideoMessageId + 1 && _lastVideoMessageId != 0) {
        // Gap detected: chunks from intermediate frame dropped
        _requestKeyframeResync(BinaryOpcode.frameSync);
      }
      _lastVideoMessageId = messageId;
    }

    final Uint8List chunkData = Uint8List.sublistView(
      rawBytes,
      kHeaderSize + kFragmentHeaderSize,
      kHeaderSize + payloadLength,
    );

    // Get or initialize assembly session
    _AssemblySession session = _sessions.putIfAbsent(
      messageId,
      () => _AssemblySession(
        messageId: messageId,
        opcode: opcode,
        totalLength: totalLength,
        baseFlags: flags & ~kFlagIsFragmented & ~kFlagIsLastFragment,
        baseSeq: seq,
      ),
    );

    session.lastActivity = DateTime.now();

    // Prevent duplicate slice writes
    if (!session.receivedOffsets.contains(offset)) {
      if (offset + chunkBytesLength <= session.totalLength) {
        session.buffer.setRange(offset, offset + chunkBytesLength, chunkData);
        session.receivedOffsets.add(offset);
        session.bytesAccumulated += chunkBytesLength;
      }
    }

    // Check completion
    if (session.isComplete) {
      _sessions.remove(messageId);
      final ProtocolPacket reassembled = ProtocolPacket(
        opcode: session.opcode,
        flags: session.baseFlags,
        seq: session.baseSeq,
        payload: session.buffer,
      );
      _completePacketStream.add(reassembled);
      return reassembled;
    }

    return null;
  }

  void _requestKeyframeResync(int syncOpcode) {
    if (!_frameSyncRequestStream.isClosed) {
      _frameSyncRequestStream.add(syncOpcode);
    }
  }

  void _purgeStaleSessions() {
    final DateTime now = DateTime.now();
    _sessions.removeWhere((id, session) {
      final bool isExpired =
          now.difference(session.lastActivity) > kFragmentSessionTtl;
      if (isExpired && session.opcode == BinaryOpcode.frame) {
        // Incomplete video frame dropped - request keyframe resync
        _requestKeyframeResync(BinaryOpcode.frameSync);
      }
      return isExpired;
    });
  }

  void dispose() {
    _cleanupTimer?.cancel();
    _completePacketStream.close();
    _frameSyncRequestStream.close();
    _sessions.clear();
  }
}

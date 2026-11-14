import 'dart:convert';
import 'dart:typed_data';

/// Magic protocol byte signature: 0xC5, 0x71
const int kMagicByte0 = 0xC5;
const int kMagicByte1 = 0x71;

/// Fixed header length in bytes (2 magic + 1 opcode + 1 flags + 4 seq + 4 length)
const int kHeaderSize = 12;

/// Maximum canonical binary payload size (10 MiB) per shared protocol contract.
const int kMaxPayloadSize = 10 * 1024 * 1024;

/// Opcode definitions for the CST Binary Protocol (Part 1.2 Specification)
class BinaryOpcode {
  static const int ping = 0x01; // 1: Heartbeat Ping/Pong
  static const int telemetry = 0x02; // 2: Hardware Telemetry Metrics
  static const int frame = 0x03; // 3: Compressed JPEG Desktop Frame
  static const int shell = 0x04; // 4: Interactive Shell Output
  static const int hitl = 0x05; // 5: Human-in-the-Loop Security Interrupt
  static const int auth = 0x06; // 6: HMAC-SHA256 Challenge/Response
  static const int clip = 0x07; // 7: Bidirectional Clipboard Sync
  static const int input = 0x08; // 8: Virtual Trackpad & Keystroke Injection
  static const int audio = 0x09; // 9: Remote Audio & Media Session Control
  static const int viewportResize =
      0x0A; // 10: Dynamic Viewport Dimension Negotiation
  static const int displayEnum =
      0x0D; // 13: Multi-Monitor Display Enumeration & Context Switching
  static const int llmStream = 0x0B; // 11: Local LLM Chunk Stream (matches agent.py OP_LLM_STREAM)
  static const int fileTransfer =
      0x0C; // 12: Chunked Zero-Trust File Transfer (Opcode 0x0C)
  static const int frameSync =
      0xED; // 237: Keyframe Resynchronization Signal (Opcode 0xED)
  static const int error = 0xEE; // 238: Structured Error Frame
}

/// Binary Protocol Flags (Bitmask)
class ProtocolFlags {
  static const int none = 0x00;
  static const int compressed = 0x01; // Bit 0: Gzip/Zlib Compressed
  static const int encrypted = 0x02; // Bit 1: ChaCha20-Poly1305 AEAD Encrypted
  static const int isFragmented =
      0x04; // Bit 2: Sub-MTU / 64KB Fragmented Chunk
  static const int isLastFragment = 0x08; // Bit 3: Terminal Fragment of Message
}

/// A parsed packet from the binary stream.
class ProtocolPacket {
  final int opcode;
  final int flags;
  final int seq;
  final Uint8List payload;

  const ProtocolPacket({
    required this.opcode,
    required this.flags,
    required this.seq,
    required this.payload,
  });

  String get payloadAsString => utf8.decode(payload, allowMalformed: true);
}

/// Parsed 12-byte canonical protocol header.
typedef ProtocolHeader = ({
  int opcode,
  int flags,
  int seq,
  int payloadLength,
});

/// Parses only the 12-byte CST header starting at [offset].
///
/// Returns `null` if fewer than [kHeaderSize] bytes remain, the magic signature
/// does not match `0xC5 0x71`, or `payloadLength` exceeds [kMaxPayloadSize].
ProtocolHeader? parseHeader(Uint8List rawBytes, {int offset = 0}) {
  if (offset < 0 || rawBytes.length - offset < kHeaderSize) {
    return null;
  }
  if (rawBytes[offset] != kMagicByte0 || rawBytes[offset + 1] != kMagicByte1) {
    return null;
  }

  final ByteData byteData = ByteData.sublistView(
    rawBytes,
    offset,
    offset + kHeaderSize,
  );
  final int payloadLength = byteData.getUint32(8, Endian.big);
  if (payloadLength > kMaxPayloadSize) {
    return null;
  }

  return (
    opcode: byteData.getUint8(2),
    flags: byteData.getUint8(3),
    seq: byteData.getUint32(4, Endian.big),
    payloadLength: payloadLength,
  );
}

/// Writes the 12-byte big-endian CST header into [buffer] starting at [offset].
void writeHeader(
  Uint8List buffer, {
  required int opcode,
  required int payloadLength,
  int flags = 0,
  int seq = 0,
  int offset = 0,
}) {
  final ByteData byteData = ByteData.sublistView(
    buffer,
    offset,
    offset + kHeaderSize,
  );
  byteData.setUint8(0, kMagicByte0);
  byteData.setUint8(1, kMagicByte1);
  byteData.setUint8(2, opcode);
  byteData.setUint8(3, flags);
  byteData.setUint32(4, seq, Endian.big);
  byteData.setUint32(8, payloadLength, Endian.big);
}

/// Packs an opcode and payload into the standard 12-byte framed binary packet.
Uint8List packPacket(int opcode, List<int> payload,
    {int flags = 0, int seq = 0}) {
  final int payloadLength = payload.length;
  final Uint8List buffer = Uint8List(kHeaderSize + payloadLength);
  writeHeader(
    buffer,
    opcode: opcode,
    payloadLength: payloadLength,
    flags: flags,
    seq: seq,
  );

  if (payloadLength > 0) {
    buffer.setRange(kHeaderSize, kHeaderSize + payloadLength, payload);
  }

  return buffer;
}

/// Parses raw incoming binary bytes into a [ProtocolPacket].
ProtocolPacket? parsePacket(Uint8List rawBytes) {
  final ProtocolHeader? header = parseHeader(rawBytes);
  if (header == null || rawBytes.length != kHeaderSize + header.payloadLength) {
    return null; // Invalid magic, oversized, truncated, or trailing-byte packet
  }

  final Uint8List payload = Uint8List.sublistView(
    rawBytes,
    kHeaderSize,
    kHeaderSize + header.payloadLength,
  );

  return ProtocolPacket(
    opcode: header.opcode,
    flags: header.flags,
    seq: header.seq,
    payload: payload,
  );
}

/// Telemetry metrics decoded from OP_TELEMETRY.
class TelemetryData {
  final String hostname;
  final double cpuPercent;
  final double ramPercent;
  final double? ramUsedGb;
  final double? ramTotalGb;
  final String os;
  final String status;
  final DateTime timestamp;

  TelemetryData({
    required this.hostname,
    required this.cpuPercent,
    required this.ramPercent,
    this.ramUsedGb,
    this.ramTotalGb,
    required this.os,
    required this.status,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  factory TelemetryData.fromJson(Map<String, dynamic> json) {
    return TelemetryData(
      hostname: json['hostname'] as String? ?? 'Host PC',
      cpuPercent: (json['cpu_percent'] as num?)?.toDouble() ?? 0.0,
      ramPercent: (json['ram_percent'] as num?)?.toDouble() ?? 0.0,
      ramUsedGb: (json['ram_used_gb'] as num?)?.toDouble(),
      ramTotalGb: (json['ram_total_gb'] as num?)?.toDouble(),
      os: json['os'] as String? ?? 'Windows',
      status: json['status'] as String? ?? 'ready',
    );
  }
}

/// HITL approval event decoded from OP_HITL.
class HitlApprovalEvent {
  final String approvalId;
  final String command;
  final String reason;
  final double timestamp;

  bool get requiresBiometric => true;

  HitlApprovalEvent({
    required this.approvalId,
    required this.command,
    required this.reason,
    required this.timestamp,
  });

  factory HitlApprovalEvent.fromJson(Map<String, dynamic> json) {
    return HitlApprovalEvent(
      approvalId: json['approval_id'] as String? ?? '',
      command: json['command'] as String? ?? '',
      reason: json['reason'] as String? ?? 'Requires operator approval',
      timestamp: (json['timestamp'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

/// Shell output decoded from OP_SHELL.
class ShellResult {
  final String status;
  final int exitCode;
  final String output;
  final String command;

  bool get isSuccess => status == 'success' && exitCode == 0;

  ShellResult({
    required this.status,
    required this.exitCode,
    required this.output,
    required this.command,
  });

  factory ShellResult.fromJson(Map<String, dynamic> json) {
    return ShellResult(
      status: json['status'] as String? ?? 'unknown',
      exitCode: json['exit_code'] as int? ?? 0,
      output: json['output'] as String? ?? '',
      command: json['command'] as String? ?? '',
    );
  }
}

/**
 * CST NetController AI - Binary Protocol Framer (0xC5 0x71)
 * 
 * Strict 12-byte binary protocol framing for zero-allocation wire communication.
 * Header layout:
 * - 0..1: Magic (0xC5, 0x71)
 * - 2: Opcode (0x01 = PING, 0x02 = PONG, 0x03 = SCREEN_FRAME, 0x04 = COMMAND, 0x05 = HITL)
 * - 3: Flags (0x00 reserved)
 * - 4..7: Sequence ID (Uint32 Big-Endian)
 * - 8..11: Payload Length (Uint32 Big-Endian)
 */

export const MAGIC_BYTE_0 = 0xC5;
export const MAGIC_BYTE_1 = 0x71;
export const HEADER_SIZE = 12;

export enum Opcode {
  OP_UNKNOWN = 0x00,
  OP_PING = 0x01,
  OP_TELEMETRY = 0x02,
  OP_PONG = 0x02, // Legacy alias
  OP_SCREEN_FRAME = 0x03,
  OP_COMMAND = 0x04,
  OP_SHELL = 0x04,
  OP_HITL = 0x05,
  OP_AUTH = 0x06,
  OP_CLIP = 0x07,
  OP_INPUT = 0x08,
  OP_AUDIO = 0x09,
  OP_VIEWPORT_RESIZE = 0x0A,
  OP_LLM_STREAM = 0x0B,
  OP_FILE_TRANSFER = 0x0C,
  OP_ERROR = 0xEE,
}

export interface ParsedHeader {
  isValid: boolean;
  opcode: Opcode;
  flags: number;
  sequenceId: number;
  payloadLength: number;
}

// Pre-allocated reusable header result and 64-byte control frame buffer for zero-GC hot paths
const SCRATCH_HEADER: ParsedHeader = {
  isValid: false,
  opcode: Opcode.OP_UNKNOWN,
  flags: 0,
  sequenceId: 0,
  payloadLength: 0,
};

const POOL_CONTROL_BUFFER = new ArrayBuffer(64);
const POOL_CONTROL_VIEW = new DataView(POOL_CONTROL_BUFFER);
const POOL_HEADER_ONLY_VIEW = new DataView(POOL_CONTROL_BUFFER, 0, HEADER_SIZE);
const POOL_CONTROL_U8 = new Uint8Array(POOL_CONTROL_BUFFER);

export function parseHeaderInto(dv: DataView, out: ParsedHeader = SCRATCH_HEADER): ParsedHeader {
  if (dv.byteLength < HEADER_SIZE) {
    out.isValid = false;
    out.opcode = Opcode.OP_UNKNOWN;
    out.flags = 0;
    out.sequenceId = 0;
    out.payloadLength = 0;
    return out;
  }

  // Validate 16-bit magic header 0xC571 in a single 16-bit big-endian read
  if (dv.getUint16(0, false) !== 0xC571) {
    out.isValid = false;
    out.opcode = Opcode.OP_UNKNOWN;
    out.flags = 0;
    out.sequenceId = 0;
    out.payloadLength = 0;
    return out;
  }

  out.isValid = true;
  out.opcode = dv.getUint8(2) as Opcode;
  out.flags = dv.getUint8(3);
  out.sequenceId = dv.getUint32(4, false);
  out.payloadLength = dv.getUint32(8, false);
  return out;
}

export function parseHeader(dv: DataView): ParsedHeader {
  if (dv.byteLength < HEADER_SIZE || dv.getUint16(0, false) !== 0xC571) {
    return { isValid: false, opcode: Opcode.OP_UNKNOWN, flags: 0, sequenceId: 0, payloadLength: 0 };
  }

  return {
    isValid: true,
    opcode: dv.getUint8(2) as Opcode,
    flags: dv.getUint8(3),
    sequenceId: dv.getUint32(4, false),
    payloadLength: dv.getUint32(8, false)
  };
}

export function packControlFrameFast(opcode: Opcode, sequenceId: number, payload?: Uint8Array): DataView {
  const payloadLen = payload ? payload.byteLength : 0;
  if (HEADER_SIZE + payloadLen > 64) {
    return new DataView(packFrame(opcode, sequenceId, payload));
  }
  POOL_CONTROL_VIEW.setUint16(0, 0xC571, false);
  POOL_CONTROL_VIEW.setUint8(2, opcode);
  POOL_CONTROL_VIEW.setUint8(3, 0x00);
  POOL_CONTROL_VIEW.setUint32(4, sequenceId, false);
  POOL_CONTROL_VIEW.setUint32(8, payloadLen, false);
  if (payload && payloadLen > 0) {
    POOL_CONTROL_U8.set(payload, HEADER_SIZE);
    return new DataView(POOL_CONTROL_BUFFER, 0, HEADER_SIZE + payloadLen);
  }
  return POOL_HEADER_ONLY_VIEW;
}

export function packFrame(opcode: Opcode, sequenceId: number, payload?: Uint8Array): ArrayBuffer {
  const payloadLen = payload ? payload.byteLength : 0;
  const totalLength = HEADER_SIZE + payloadLen;
  const buffer = new ArrayBuffer(totalLength);
  const dv = new DataView(buffer);

  dv.setUint16(0, 0xC571, false);
  dv.setUint8(2, opcode);
  dv.setUint8(3, 0x00);
  dv.setUint32(4, sequenceId, false);
  dv.setUint32(8, payloadLen, false);

  if (payload && payloadLen > 0) {
    new Uint8Array(buffer, HEADER_SIZE).set(payload);
  }

  return buffer;
}

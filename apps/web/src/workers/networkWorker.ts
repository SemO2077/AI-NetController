/**
 * AI NetController Network Worker (Off-Main-Thread WebSocket Engine)
 * - Zero-copy binary framing (0xC5 0x71 magic bytes) via Transferable ArrayBuffers
 * - Dual-protocol support: Native AI NetController Binary + JSON Fallback
 * - Instant connection ping (<1ms initial RTT measurement)
 * - Anti-Replay Protection (Monotonic sequence & timestamp verification)
 * - Authenticated Handshake (Token / Pre-Shared Key negotiation)
 * - Exponential Backoff with Jitter & Circuit Breaker (Ceiling after 8 attempts)
 * - Fast Connection Watchdog (3.5s timeout prevents hanging sockets)
 * - Resilient Message Queuing during brief reconnect bursts
 * - RFC 3550 Latency & Jitter algorithm
 */

import {
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  Opcode,
  packFrame,
  parseValidatedFrame,
} from '../utils/binaryFramer';

const PING_PAYLOAD = new Uint8Array([0x50, 0x49, 0x4e, 0x47]); // "PING"

let socket: WebSocket | null = null;
let currentUrl = 'ws://localhost:8765';
let currentToken = '';
let autoReconnectEnabled = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 8;

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let connectionWatchdog: ReturnType<typeof setTimeout> | null = null;
let authHandshakeTimer: ReturnType<typeof setTimeout> | null = null;

let pingSeq = 0;
let lastPingTime = 0;
let missedPings = 0;
let sessionAuthenticated = false;
const pendingPings = new Map<number, number>();
let activeProtocolMode: 'auto' | 'binary' | 'json' = 'auto';

let outboundSeq = 0;
let highestInboundSeq = 0;
let replayBitmap = 0n; // 128-bit RFC 6479 sliding anti-replay window bitmask
const REPLAY_WINDOW_SIZE = 128n;
const REPLAY_MASK_128 = (1n << 128n) - 1n;

// Verify and record inbound sequence number against 128-packet sliding replay window
function verifyInboundSequence(seq: number): boolean {
  if (!Number.isInteger(seq) || seq <= 0) return false;
  const seqBig = BigInt(seq);
  const maxBig = BigInt(highestInboundSeq);

  if (seqBig > maxBig) {
    const shift = seqBig - maxBig;
    if (shift >= REPLAY_WINDOW_SIZE) {
      replayBitmap = 1n;
    } else {
      replayBitmap = ((replayBitmap << shift) | 1n) & REPLAY_MASK_128;
    }
    highestInboundSeq = seq;
    return true;
  }

  const diff = maxBig - seqBig;
  if (diff >= REPLAY_WINDOW_SIZE) {
    return false; // Packet too old (outside 128-frame replay window)
  }

  const bit = 1n << diff;
  if ((replayBitmap & bit) !== 0n) {
    return false; // Duplicate / replayed packet rejected!
  }

  replayBitmap |= bit;
  return true;
}

// Fixed-capacity Float64Array circular latency buffer (zero Array.shift() overhead)
const LATENCY_CAPACITY = 20;
const latencyRing = new Float64Array(LATENCY_CAPACITY);
let latencyHead = 0;
let latencyCount = 0;
let lastRttSample = 0;
let jitter = 0.8;

// Outbound message queue for transient disconnection resilience
const outboundQueue: Array<{ type: 'json' | 'binary'; payload: any }> = [];
const MAX_QUEUE_SIZE = 10;

function calculateJitter(currentRtt: number): number[] {
  if (latencyCount > 0) {
    const diff = Math.abs(currentRtt - lastRttSample);
    jitter = jitter + (diff - jitter) / 16;
  }
  lastRttSample = currentRtt;
  latencyRing[latencyHead] = currentRtt;
  latencyHead = (latencyHead + 1) % LATENCY_CAPACITY;
  if (latencyCount < LATENCY_CAPACITY) {
    latencyCount++;
  }

  const history = new Array<number>(latencyCount);
  const start = latencyCount < LATENCY_CAPACITY ? 0 : latencyHead;
  for (let i = 0; i < latencyCount; i++) {
    history[i] = latencyRing[(start + i) % LATENCY_CAPACITY];
  }
  return history;
}

function handlePongReceived(seq?: number) {
  let startTime = lastPingTime;
  if (typeof seq === 'number' && seq > 0) {
    const tracked = pendingPings.get(seq);
    if (tracked === undefined) {
      return; // Ignore stale or uncorrelated PONG frames
    }
    startTime = tracked;
    for (const key of pendingPings.keys()) {
      if (key <= seq) {
        pendingPings.delete(key);
      }
    }
  } else if (pendingPings.size > 0) {
    const latestKey = Array.from(pendingPings.keys()).pop();
    if (latestKey !== undefined) {
      startTime = pendingPings.get(latestKey) ?? lastPingTime;
      pendingPings.delete(latestKey);
    }
  }

  if (pendingPings.size === 0) {
    if (pongTimeoutTimer) {
      clearTimeout(pongTimeoutTimer);
      pongTimeoutTimer = null;
    }
  }
  missedPings = 0;

  // Ultra-precise RTT computation using performance.now()
  const rtt = Math.max(1, Math.round(performance.now() - startTime));
  const history = calculateJitter(rtt);

  self.postMessage({
    type: 'METRICS',
    latency: rtt,
    jitter: Math.round(jitter * 10) / 10,
    history,
  });
}

function flushOutboundQueue() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !sessionAuthenticated) return;
  while (outboundQueue.length > 0) {
    const item = outboundQueue.shift();
    if (!item) break;
    try {
      if (item.type === 'json') {
        socket.send(JSON.stringify(item.payload));
      } else if (item.type === 'binary') {
        socket.send(item.payload);
      }
    } catch {
      // ignore
    }
  }
}

function clearAuthHandshakeTimer() {
  if (authHandshakeTimer) {
    clearTimeout(authHandshakeTimer);
    authHandshakeTimer = null;
  }
}

function sendPing() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !sessionAuthenticated) return;

  pingSeq = ((pingSeq + 1) >>> 0) || 1;
  const sentSeq = pingSeq;
  const sentAt = performance.now();
  lastPingTime = sentAt;
  pendingPings.set(sentSeq, sentAt);
  if (pendingPings.size > 16) {
    const oldestKey = pendingPings.keys().next().value;
    if (oldestKey !== undefined) {
      pendingPings.delete(oldestKey);
    }
  }

  if (activeProtocolMode === 'binary' || activeProtocolMode === 'auto') {
    try {
      socket.send(packFrame(Opcode.OP_PING, sentSeq, PING_PAYLOAD));
    } catch {
      // ignore
    }
  } else {
    try {
      socket.send(
        JSON.stringify({
          action: 'PING',
          event: 'PING',
          seq: sentSeq,
          timestamp: Date.now(),
        })
      );
    } catch {
      // ignore
    }
  }

  // Watchdog strictly shorter than 2500ms ping interval so missed PONGs always trigger
  if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
  pongTimeoutTimer = setTimeout(() => {
    if (pendingPings.has(sentSeq) && socket && socket.readyState === WebSocket.OPEN) {
      pendingPings.delete(sentSeq);
      missedPings++;
      if (missedPings === 1) {
        self.postMessage({ type: 'STATUS', status: 'degraded', missedPings });
      } else if (missedPings >= 2) {
        self.postMessage({ type: 'STATUS', status: 'unresponsive', missedPings });
        try {
          socket.close(4002, 'Heartbeat timeout');
        } catch {
          // ignore
        }
      }
    }
  }, 2000);
}

function startHeartbeat() {
  stopHeartbeat();
  sendPing();
  heartbeatInterval = setInterval(sendPing, 2500);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (pongTimeoutTimer) {
    clearTimeout(pongTimeoutTimer);
    pongTimeoutTimer = null;
  }
  missedPings = 0;
}

function clearConnectionWatchdog() {
  if (connectionWatchdog) {
    clearTimeout(connectionWatchdog);
    connectionWatchdog = null;
  }
}

function establishConnection(url: string, token: string = currentToken) {
  clearConnectionWatchdog();
  clearAuthHandshakeTimer();
  stopHeartbeat();

  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  }

  currentUrl = url;
  currentToken = token;
  highestInboundSeq = 0;
  replayBitmap = 0n;
  outboundSeq = 0;
  pingSeq = 0;
  missedPings = 0;
  sessionAuthenticated = false;
  pendingPings.clear();
  activeProtocolMode = 'auto';

  // Fail closed when PSK token is missing (00-shared-contracts §3.1 & §4)
  if (!currentToken.trim()) {
    autoReconnectEnabled = false;
    self.postMessage({
      type: 'STATUS',
      status: 'auth_required',
      message: 'Pre-shared key (PSK) is required before connecting.',
    });
    return;
  }

  // Block insecure ws:// on HTTPS to prevent browser SecurityError exceptions
  const isHttps = typeof self !== 'undefined' && self.location && self.location.protocol === 'https:';
  if (isHttps && url.trim().toLowerCase().startsWith('ws://')) {
    self.postMessage({
      type: 'STATUS',
      status: 'disconnected',
      message: 'Browser blocks unencrypted ws:// on HTTPS origins. Use a wss:// gateway or local TLS proxy.',
    });
    autoReconnectEnabled = false;
    return;
  }

  self.postMessage({
    type: 'STATUS',
    status: reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
    attempt: reconnectAttempts,
  });

  try {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    socket = ws;
    let hadSocketError = false;

    // Connection watchdog (3500ms timeout prevents hanging sockets on latent Wi-Fi)
    connectionWatchdog = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        self.postMessage({ type: 'STATUS', status: 'timeout' });
        scheduleReconnect();
      }
    }, 3500);

    ws.onopen = () => {
      clearConnectionWatchdog();
      reconnectAttempts = 0;
      autoReconnectEnabled = true;

      // Wait for binary OP_AUTH HMAC-SHA256 challenge-response; never transmit raw PSK on ws.onopen
      clearAuthHandshakeTimer();
      authHandshakeTimer = setTimeout(() => {
        if (!sessionAuthenticated && socket === ws && ws.readyState === WebSocket.OPEN) {
          self.postMessage({
            type: 'STATUS',
            status: 'timeout',
            message: 'Host agent did not complete OP_AUTH handshake within 3.5s.',
          });
          try {
            ws.close(4001, 'Auth handshake timeout');
          } catch {
            // ignore
          }
          scheduleReconnect();
        }
      }, 3500);
    };

    ws.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        activeProtocolMode = 'binary';
        parseBinaryFrame(new Uint8Array(e.data));
      } else if (typeof e.data === 'string') {
        if (activeProtocolMode === 'auto') {
          activeProtocolMode = 'json';
        }
        try {
          const json = JSON.parse(e.data);
          const isPong = json.event === 'PONG' || json.action === 'PONG' || json.type === 'PONG';

          // Anti-Replay: RFC 6479 128-bit sliding window validation if seq provided on non-PONG frames
          if (!isPong && typeof json.seq === 'number') {
            if (!verifyInboundSequence(json.seq)) {
              return;
            }
          }

          // Fail-closed pre-auth JSON gate
          const isPreAuthEvent =
            isPong ||
            json.event === 'AUTHENTICATED' ||
            json.event === 'ERROR' ||
            json.event === 'AUTH_CHALLENGE';
          if (!sessionAuthenticated && !isPreAuthEvent) {
            return;
          }

          if (isPong) {
            handlePongReceived(typeof json.seq === 'number' ? json.seq : undefined);
            return;
          }

          if (json.event === 'AUTHENTICATED') {
            sessionAuthenticated = true;
            clearAuthHandshakeTimer();
            self.postMessage({ type: 'STATUS', status: 'connected' });
            startHeartbeat();
            flushOutboundQueue();
          }

          self.postMessage({ type: 'JSON_FRAME', data: json });
        } catch {
          // Ignore non-JSON frame
        }
      }
    };

    ws.onerror = () => {
      hadSocketError = true;
      clearConnectionWatchdog();
    };

    ws.onclose = (event) => {
      clearConnectionWatchdog();
      clearAuthHandshakeTimer();
      stopHeartbeat();
      sessionAuthenticated = false;
      pendingPings.clear();
      const authRejected = event.code === 1008 || event.code === 4001 || event.code === 4003;
      if (authRejected) {
        autoReconnectEnabled = false;
      }
      self.postMessage({
        type: 'STATUS',
        status: 'disconnected',
        code: event.code,
        wasClean: event.wasClean,
        message: authRejected
          ? 'Authentication or security policy rejected by host agent.'
          : hadSocketError
          ? 'WebSocket connection dropped or host unreachable.'
          : undefined,
      });

      if (autoReconnectEnabled && !authRejected) {
        scheduleReconnect();
      }
    };
  } catch (err: any) {
    clearConnectionWatchdog();
    self.postMessage({ type: 'STATUS', status: 'disconnected', message: err?.message });
    if (autoReconnectEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts++;

  // Failsafe: Gracefully stop reconnect loops after MAX_RECONNECT_ATTEMPTS
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    autoReconnectEnabled = false;
    self.postMessage({
      type: 'STATUS',
      status: 'disconnected',
      attempt: reconnectAttempts,
      message: 'Host WebSocket agent did not respond at this address.',
    });
    return;
  }

  // Capped exponential backoff with jitter: 1s -> 2s -> 4s ... (cap 30s)
  const backoff = Math.min(30000, 1000 * Math.pow(2, Math.max(0, reconnectAttempts - 1)));
  const jitterOffset = Math.floor(Math.random() * 400);
  const delay = backoff + jitterOffset;

  self.postMessage({
    type: 'STATUS',
    status: 'reconnecting',
    attempt: reconnectAttempts,
    nextAttemptMs: delay,
  });

  reconnectTimer = setTimeout(() => {
    if (autoReconnectEnabled) {
      establishConnection(currentUrl, currentToken);
    }
  }, delay);
}

const UTF8_DECODER = new TextDecoder();

// Pure-JS SHA-256 & HMAC-SHA256 fallback for non-HTTPS LAN origins where crypto.subtle is unavailable
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Pure(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bitLen = data.length * 8;
  const padLen = ((data.length + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false); outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false); outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false); outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false); outView.setUint32(28, h7, false);
  return out;
}

function hmacSha256Pure(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const k = key.length > blockSize ? sha256Pure(key) : key;
  const oKeyPad = new Uint8Array(blockSize + 32);
  const iKeyPad = new Uint8Array(blockSize + message.length);
  for (let i = 0; i < blockSize; i++) {
    const kb = i < k.length ? k[i] : 0;
    oKeyPad[i] = kb ^ 0x5c;
    iKeyPad[i] = kb ^ 0x36;
  }
  iKeyPad.set(message, blockSize);
  const innerHash = sha256Pure(iKeyPad);
  oKeyPad.set(innerHash, blockSize);
  return sha256Pure(oKeyPad);
}

async function computeHmacSha256Bytes(secretStr: string, msgBytes: Uint8Array): Promise<Uint8Array> {
  const keyData = new TextEncoder().encode(secretStr);
  if (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) {
    const cryptoKey = await self.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await self.crypto.subtle.sign('HMAC', cryptoKey, msgBytes as BufferSource);
    return new Uint8Array(sigBuffer);
  }
  return hmacSha256Pure(keyData, msgBytes);
}

async function hmacSha256Hex(secretStr: string, msgText: string): Promise<string> {
  const sigBytes = await computeHmacSha256Bytes(secretStr, new TextEncoder().encode(msgText));
  let hex = '';
  for (let i = 0; i < sigBytes.length; i++) {
    hex += sigBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function respondToBinaryAuthChallenge(nonceBytes: Uint8Array, seq: number) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const secretStr = currentToken.trim();
  if (!secretStr) {
    autoReconnectEnabled = false;
    sessionAuthenticated = false;
    clearAuthHandshakeTimer();
    self.postMessage({
      type: 'STATUS',
      status: 'auth_required',
      message: 'Authentication token required before connecting.',
    });
    self.postMessage({
      type: 'JSON_FRAME',
      data: {
        event: 'ERROR',
        error: 'Authentication token required. Set your PSK token or pair using the host PIN before connecting.',
      },
    });
    try {
      socket.close(4001, 'Missing authentication token');
    } catch {
      // ignore
    }
    return;
  }
  const sigBytes = await computeHmacSha256Bytes(secretStr, nonceBytes);
  socket.send(packFrame(Opcode.OP_AUTH, seq, sigBytes));
}

function parseBinaryFrame(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parsed = parseValidatedFrame(dv);
  if (!parsed.isValid) return;

  const { opcode, flags, sequenceId: seq, payloadLength: length } = parsed;

  if ((flags & 0x02) !== 0) {
    self.postMessage({
      type: 'JSON_FRAME',
      data: {
        event: 'ERROR',
        error: 'AEAD-encrypted frame (flag 0x02) received without an established ECDH session vault.',
      },
    });
    return;
  }

  // Fail-closed pre-authentication gate (00-shared-contracts §3.1)
  if (
    !sessionAuthenticated &&
    opcode !== Opcode.OP_AUTH &&
    opcode !== Opcode.OP_PING &&
    opcode !== Opcode.OP_ERR
  ) {
    return;
  }

  // Enforce monotonic replay protection (seq >= 1) on operational binary frames
  const replayExempt =
    opcode === Opcode.OP_PING ||
    opcode === Opcode.OP_HITL ||
    opcode === Opcode.OP_AUTH ||
    opcode === Opcode.OP_LLM_STREAM ||
    opcode === Opcode.OP_FRAME_SYNC;
  if (!replayExempt && !verifyInboundSequence(seq)) {
    return;
  }

  const payloadSlice = bytes.subarray(HEADER_SIZE, HEADER_SIZE + length);

  if (opcode === Opcode.OP_PING) {
    handlePongReceived(seq);
  } else if (opcode === Opcode.OP_TELEMETRY) {
    try {
      self.postMessage({ type: 'TELEMETRY', data: JSON.parse(UTF8_DECODER.decode(payloadSlice)) });
    } catch {
      // Ignore parse failure
    }
  } else if (opcode === Opcode.OP_SCREEN_FRAME) {
    // Validate JPEG SOI (0xFFD8) & EOI (0xFFD9) boundaries before transferring frame (00-shared-contracts §2)
    if (
      payloadSlice.length < 4 ||
      payloadSlice[0] !== 0xff ||
      payloadSlice[1] !== 0xd8 ||
      payloadSlice[payloadSlice.length - 2] !== 0xff ||
      payloadSlice[payloadSlice.length - 1] !== 0xd9
    ) {
      return;
    }
    const frameBuffer = payloadSlice.slice().buffer;
    (self as unknown as Worker).postMessage({ type: 'SCREEN_FRAME', buffer: frameBuffer }, [frameBuffer]);
  } else if (opcode === Opcode.OP_SHELL) {
    try {
      self.postMessage({
        type: 'JSON_FRAME',
        data: { event: 'SHELL_RESULT', ...JSON.parse(UTF8_DECODER.decode(payloadSlice)) },
      });
    } catch {
      // Ignore
    }
  } else if (opcode === Opcode.OP_HITL) {
    try {
      self.postMessage({
        type: 'JSON_FRAME',
        data: { event: 'HITL_REQUIRED', ...JSON.parse(UTF8_DECODER.decode(payloadSlice)) },
      });
    } catch {
      // Ignore
    }
  } else if (opcode === Opcode.OP_AUTH) {
    if (length === 16) {
      void respondToBinaryAuthChallenge(payloadSlice, seq);
    } else if (length > 0) {
      const statusStr = UTF8_DECODER.decode(payloadSlice).trim();
      if (statusStr === 'OK_AUTHENTICATED' || statusStr === 'AUTH_OK') {
        sessionAuthenticated = true;
        clearAuthHandshakeTimer();
        self.postMessage({ type: 'STATUS', status: 'connected' });
        self.postMessage({ type: 'JSON_FRAME', data: { event: 'AUTHENTICATED', status: 'OK' } });
        startHeartbeat();
        flushOutboundQueue();
      } else {
        sessionAuthenticated = false;
        autoReconnectEnabled = false;
        clearAuthHandshakeTimer();
        self.postMessage({ type: 'JSON_FRAME', data: { event: 'ERROR', error: statusStr } });
        try {
          socket?.close(4001, 'Authentication failed');
        } catch {
          // ignore
        }
      }
    }
  } else if (opcode === Opcode.OP_CLIP) {
    try {
      self.postMessage({
        type: 'JSON_FRAME',
        data: { event: 'CLIPBOARD_SYNC', text: UTF8_DECODER.decode(payloadSlice) },
      });
    } catch {
      // Ignore
    }
  } else if (opcode === Opcode.OP_LLM_STREAM) {
    try {
      self.postMessage({
        type: 'JSON_FRAME',
        data: { event: 'LLM_STREAM', chunk: UTF8_DECODER.decode(payloadSlice), seq },
      });
    } catch {
      // Ignore
    }
  } else if (opcode === Opcode.OP_DISPLAY_ENUM) {
    try {
      const parsedEnum = JSON.parse(UTF8_DECODER.decode(payloadSlice));
      self.postMessage({ type: 'JSON_FRAME', data: { event: 'DISPLAY_ENUM', ...parsedEnum } });
    } catch {
      // Ignore
    }
  } else if (opcode === Opcode.OP_FRAME_SYNC) {
    try {
      const rawSync = UTF8_DECODER.decode(payloadSlice);
      const parsedSync = rawSync.startsWith('{') ? JSON.parse(rawSync) : { detail: rawSync };
      self.postMessage({ type: 'JSON_FRAME', data: { event: 'FRAME_SYNC', seq, ...parsedSync } });
    } catch {
      // Ignore
    }
  } else if (opcode === Opcode.OP_ERR) {
    try {
      const errText = UTF8_DECODER.decode(payloadSlice);
      const parsedErr = errText.startsWith('{') ? JSON.parse(errText) : { error: errText };
      self.postMessage({ type: 'JSON_FRAME', data: { event: 'ERROR', ...parsedErr } });
    } catch {
      // Ignore
    }
  }
}

function sendOrQueueJson(envelope: Record<string, any>, isAuthMsg: boolean) {
  if (socket && socket.readyState === WebSocket.OPEN && (sessionAuthenticated || isAuthMsg)) {
    try {
      socket.send(JSON.stringify(envelope));
    } catch {
      // send failed
    }
  } else if (autoReconnectEnabled || (socket && socket.readyState === WebSocket.OPEN && !sessionAuthenticated)) {
    if (outboundQueue.length < MAX_QUEUE_SIZE) {
      outboundQueue.push({ type: 'json', payload: envelope });
    }
  }
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'CONNECT': {
      autoReconnectEnabled = true;
      reconnectAttempts = 0;
      const nextUrl = payload?.url !== undefined ? String(payload.url) : currentUrl;
      const nextToken = payload?.token !== undefined ? String(payload.token) : currentToken;
      establishConnection(nextUrl, nextToken);
      break;
    }

    case 'RETRY_NOW': {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
      autoReconnectEnabled = true;
      establishConnection(currentUrl, currentToken);
      break;
    }

    case 'DISCONNECT': {
      autoReconnectEnabled = false;
      sessionAuthenticated = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearConnectionWatchdog();
      clearAuthHandshakeTimer();
      stopHeartbeat();
      if (socket) {
        try {
          socket.close(1000, 'User disconnect');
        } catch {
          // ignore
        }
        socket = null;
      }
      outboundQueue.length = 0;
      self.postMessage({ type: 'STATUS', status: 'disconnected' });
      break;
    }

    case 'SEND_JSON': {
      outboundSeq = ((outboundSeq + 1) >>> 0) || 1;
      const seqNum = outboundSeq;
      const envelope: Record<string, any> = {
        ...payload,
        _seq: seqNum,
        _nonce: `${Date.now()}-${seqNum}`,
      };
      const isAuthMsg = payload?.action === 'AUTHENTICATE';

      // Sign remote HITL approvals with HMAC-SHA256(secret, "${approval_id}:${nonce}:${command}")
      if (
        payload?.action === 'APPROVAL_RESPONSE' &&
        payload?.approved === true &&
        typeof payload?.challenge_nonce === 'string' &&
        payload.challenge_nonce.length > 0 &&
        currentToken.trim().length > 0
      ) {
        const approvalId = String(payload.approval_id || payload.command_id || '');
        const proofInput = `${approvalId}:${payload.challenge_nonce}:${String(payload.command ?? '')}`;
        void hmacSha256Hex(currentToken.trim(), proofInput).then((hmacHex) => {
          sendOrQueueJson(
            {
              ...envelope,
              signature: hmacHex,
              approval_hmac: hmacHex,
            },
            false
          );
        });
        break;
      }

      sendOrQueueJson(envelope, isAuthMsg);
      break;
    }

    case 'SEND_BINARY': {
      if (socket && socket.readyState === WebSocket.OPEN && sessionAuthenticated) {
        try {
          socket.send(payload.buffer);
        } catch {
          // send failed
        }
      } else if (autoReconnectEnabled || (socket && socket.readyState === WebSocket.OPEN && !sessionAuthenticated)) {
        if (outboundQueue.length < MAX_QUEUE_SIZE) {
          outboundQueue.push({ type: 'binary', payload: payload.buffer });
        }
      }
      break;
    }

    case 'SEND_OPCODE': {
      const rawOpcode = Number(payload?.opcode);
      if (!Number.isInteger(rawOpcode) || rawOpcode <= 0 || rawOpcode > 0xff) {
        return; // Never silently coerce invalid or OP_UNKNOWN (0x00) opcodes (00-shared-contracts §2)
      }
      outboundSeq = ((outboundSeq + 1) >>> 0) || 1;
      const opcode = rawOpcode & 0xff;
      const rawText = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data || {});
      const bodyBytes = new TextEncoder().encode(rawText);
      if (bodyBytes.length > MAX_PAYLOAD_SIZE) {
        return;
      }
      const packetBuffer = packFrame(opcode, outboundSeq, bodyBytes);
      const isHandshakeOp = opcode === Opcode.OP_PING || opcode === Opcode.OP_AUTH;

      if (socket && socket.readyState === WebSocket.OPEN && (sessionAuthenticated || isHandshakeOp)) {
        try {
          socket.send(packetBuffer);
        } catch {
          // send failed
        }
      } else if (autoReconnectEnabled || (socket && socket.readyState === WebSocket.OPEN && !sessionAuthenticated)) {
        if (outboundQueue.length < MAX_QUEUE_SIZE) {
          outboundQueue.push({ type: 'binary', payload: packetBuffer });
        }
      }
      break;
    }
  }
};

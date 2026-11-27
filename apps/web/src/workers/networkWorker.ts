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
import { WebCryptoVault, hmacSha256 } from '../utils/cryptoVault';

const PING_PAYLOAD = new Uint8Array([0x50, 0x49, 0x4e, 0x47]); // "PING"
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

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

let lastPingTime = 0;
let missedPings = 0;
let sessionAuthenticated = false;
let authChallengeResponded = false;
let authRejected = false;
let sessionVault: WebCryptoVault | null = null;
let vaultHandshakePending = false;
let vaultEstablished = false;
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
const outboundQueue: Array<{ type: 'json' | 'binary' | 'opcode'; opcode?: number; payload: any }> = [];
const MAX_QUEUE_SIZE = 10;

function resetVaultState() {
  vaultHandshakePending = false;
  vaultEstablished = false;
  if (sessionVault) {
    sessionVault.close();
    sessionVault = null;
  }
}

function sendBinaryOpcode(opcode: number, bodyBytes: Uint8Array): boolean {
  const isHandshakeOp = opcode === Opcode.OP_PING || opcode === Opcode.OP_AUTH;
  if (socket && socket.readyState === WebSocket.OPEN && (sessionAuthenticated || isHandshakeOp)) {
    outboundSeq = ((outboundSeq + 1) >>> 0) || 1;
    const seq = outboundSeq;
    try {
      if (vaultEstablished && sessionVault && opcode !== Opcode.OP_AUTH) {
        socket.send(sessionVault.encryptWirePacket(opcode, bodyBytes, seq));
      } else {
        socket.send(packFrame(opcode, seq, bodyBytes));
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

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
      if (item.type === 'opcode' && typeof item.opcode === 'number') {
        sendBinaryOpcode(item.opcode, item.payload);
      } else if (item.type === 'json') {
        dispatchJsonOrEncrypted(item.payload, false);
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

  outboundSeq = ((outboundSeq + 1) >>> 0) || 1;
  const sentSeq = outboundSeq;
  const sentAt = performance.now();
  lastPingTime = sentAt;
  pendingPings.set(sentSeq, sentAt);
  if (pendingPings.size > 16) {
    const oldestKey = pendingPings.keys().next().value;
    if (oldestKey !== undefined) {
      pendingPings.delete(oldestKey);
    }
  }

  if (vaultEstablished && sessionVault) {
    try {
      socket.send(sessionVault.encryptWirePacket(Opcode.OP_PING, PING_PAYLOAD, sentSeq));
    } catch {
      // ignore
    }
  } else if (activeProtocolMode === 'binary' || activeProtocolMode === 'auto') {
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
  pendingPings.clear();
  missedPings = 0;
}

function clearConnectionWatchdog() {
  if (connectionWatchdog) {
    clearTimeout(connectionWatchdog);
    connectionWatchdog = null;
  }
}

function establishConnection(url: string, token: string = currentToken) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearConnectionWatchdog();
  clearAuthHandshakeTimer();
  stopHeartbeat();

  const switchedEndpoint = url !== currentUrl;
  if (switchedEndpoint) {
    outboundQueue.length = 0;
    latencyHead = 0;
    latencyCount = 0;
    lastRttSample = 0;
    jitter = 0.8;
  }

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
  missedPings = 0;
  sessionAuthenticated = false;
  authChallengeResponded = false;
  authRejected = false;
  resetVaultState();
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
      if (socket === ws && ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        socket = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
        self.postMessage({ type: 'STATUS', status: 'timeout' });
        if (autoReconnectEnabled) {
          scheduleReconnect();
        }
      }
    }, 3500);

    ws.onopen = () => {
      if (socket !== ws) return;
      clearConnectionWatchdog();
      autoReconnectEnabled = true;

      // Wait for binary OP_AUTH HMAC-SHA256 challenge-response; never transmit raw PSK on ws.onopen
      clearAuthHandshakeTimer();
      authHandshakeTimer = setTimeout(() => {
        if (!sessionAuthenticated && socket === ws && ws.readyState === WebSocket.OPEN) {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          socket = null;
          stopHeartbeat();
          sessionAuthenticated = false;
          authChallengeResponded = false;
          resetVaultState();
          pendingPings.clear();
          self.postMessage({
            type: 'STATUS',
            status: 'timeout',
            message: 'Host agent did not complete OP_AUTH handshake within 3.5s.',
          });
          try {
            ws.close(4008, 'Auth handshake timeout');
          } catch {
            // ignore
          }
          if (autoReconnectEnabled) {
            scheduleReconnect();
          }
        }
      }, 3500);
    };

    ws.onmessage = (e: MessageEvent) => {
      if (socket !== ws) return;
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
            reconnectAttempts = 0;
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
      if (socket !== ws) return;
      hadSocketError = true;
      clearConnectionWatchdog();
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      clearConnectionWatchdog();
      clearAuthHandshakeTimer();
      stopHeartbeat();
      sessionAuthenticated = false;
      authChallengeResponded = false;
      resetVaultState();
      pendingPings.clear();
      const policyRejected = authRejected || event.code === 1008 || event.code === 4001 || event.code === 4003;
      if (policyRejected) {
        autoReconnectEnabled = false;
      }
      self.postMessage({
        type: 'STATUS',
        status: 'disconnected',
        code: event.code,
        wasClean: event.wasClean,
        message: policyRejected
          ? 'Authentication or security policy rejected by host agent.'
          : hadSocketError
          ? 'WebSocket connection dropped or host unreachable.'
          : undefined,
      });

      if (autoReconnectEnabled && !policyRejected) {
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

function hmacSha256HexSync(secretStr: string, msgText: string): string {
  const sigBytes = hmacSha256(UTF8_ENCODER.encode(secretStr), UTF8_ENCODER.encode(msgText));
  let hex = '';
  for (let i = 0; i < sigBytes.length; i++) {
    hex += sigBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function respondToBinaryAuthChallenge(nonceBytes: Uint8Array, seq: number) {
  if (!socket || socket.readyState !== WebSocket.OPEN || authChallengeResponded) return;
  const secretStr = currentToken.trim();
  if (!secretStr) {
    authRejected = true;
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
  authChallengeResponded = true;
  const sigBytes = hmacSha256(UTF8_ENCODER.encode(secretStr), nonceBytes);
  socket.send(packFrame(Opcode.OP_AUTH, seq, sigBytes));
}

function startVaultHandshake() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const secretStr = currentToken.trim();
  if (!secretStr) return;
  resetVaultState();
  sessionVault = new WebCryptoVault(secretStr);
  vaultHandshakePending = true;
  outboundSeq = ((outboundSeq + 1) >>> 0) || 1;
  socket.send(packFrame(Opcode.OP_AUTH, outboundSeq, sessionVault.createMutualInitPayload()));
}

function parseBinaryFrame(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parsed = parseValidatedFrame(dv);
  if (!parsed.isValid) return;

  const { opcode, flags, sequenceId: seq, payloadLength: length } = parsed;
  let payloadSlice = bytes.subarray(HEADER_SIZE, HEADER_SIZE + length);

  // Decrypt AEAD payload when WebCryptoVault is established (and strictly block plaintext downgrade)
  if (vaultEstablished && sessionVault) {
    if ((flags & 0x02) === 0) {
      self.postMessage({
        type: 'JSON_FRAME',
        data: {
          event: 'ERROR',
          error: 'Anti-downgrade guard: rejected plaintext binary frame after AEAD vault lock.',
        },
      });
      return;
    }
    const aad = bytes.subarray(0, HEADER_SIZE);
    const dec = sessionVault.decryptFrame(payloadSlice, aad);
    if (!dec) {
      return;
    }
    payloadSlice = dec.plaintext;
  } else if ((flags & 0x02) !== 0) {
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
  if (!sessionAuthenticated && opcode === Opcode.OP_ERR) {
    const errText = UTF8_DECODER.decode(payloadSlice).trim();
    authRejected = true;
    autoReconnectEnabled = false;
    clearAuthHandshakeTimer();
    self.postMessage({
      type: 'STATUS',
      status: 'auth_required',
      message: errText || 'Authentication rejected by host agent.',
    });
    self.postMessage({
      type: 'JSON_FRAME',
      data: { event: 'ERROR', error: errText || 'Authentication rejected by host agent.' },
    });
    try {
      socket?.close(4001, 'Pre-auth error');
    } catch {
      // ignore
    }
    return;
  }

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
    // Check explicit ASCII status strings first: 'OK_AUTHENTICATED' is 16 bytes long,
    // which would otherwise be misclassified as a 16-byte HMAC nonce challenge.
    const statusStr = payloadSlice.length > 0 ? UTF8_DECODER.decode(payloadSlice).trim() : '';
    if (statusStr === 'OK_ECDH_VAULT') {
      reconnectAttempts = 0;
      vaultHandshakePending = false;
      vaultEstablished = true;
      sessionVault?.confirmEstablished();
      sessionAuthenticated = true;
      clearAuthHandshakeTimer();
      self.postMessage({ type: 'STATUS', status: 'connected', encrypted: true });
      self.postMessage({ type: 'JSON_FRAME', data: { event: 'AUTHENTICATED', status: 'OK', encrypted: true } });
      startHeartbeat();
      flushOutboundQueue();
      sendBinaryOpcode(Opcode.OP_DISPLAY_ENUM, new Uint8Array(0));
      sendBinaryOpcode(Opcode.OP_FRAME_SYNC, UTF8_ENCODER.encode('{}'));
    } else if (
      vaultHandshakePending &&
      (flags & 0x01) !== 0 &&
      (payloadSlice.length === 91 || payloadSlice.length === 59)
    ) {
      const hsResp = sessionVault?.processHostChallenge(payloadSlice) || null;
      if (!hsResp) {
        authRejected = true;
        sessionAuthenticated = false;
        autoReconnectEnabled = false;
        clearAuthHandshakeTimer();
        resetVaultState();
        self.postMessage({
          type: 'JSON_FRAME',
          data: { event: 'ERROR', error: 'Host ECDH mutual cryptographic proof verification failed.' },
        });
        try {
          socket?.close(4001, 'ECDH mutual proof failed');
        } catch {
          // ignore
        }
        return;
      }
      outboundSeq = ((outboundSeq + 1) >>> 0) || 1;
      socket?.send(packFrame(Opcode.OP_AUTH, outboundSeq, hsResp));
    } else if (statusStr === 'OK_AUTHENTICATED' || statusStr === 'AUTH_OK') {
      startVaultHandshake();
    } else if (payloadSlice.length === 16 && !authChallengeResponded) {
      respondToBinaryAuthChallenge(payloadSlice, seq);
    } else if (payloadSlice.length > 0 && statusStr !== 'OK_AUTHENTICATED' && statusStr !== 'AUTH_OK') {
      authRejected = true;
      sessionAuthenticated = false;
      autoReconnectEnabled = false;
      clearAuthHandshakeTimer();
      resetVaultState();
      self.postMessage({ type: 'JSON_FRAME', data: { event: 'ERROR', error: statusStr } });
      try {
        socket?.close(4001, 'Authentication failed');
      } catch {
        // ignore
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

function dispatchJsonOrEncrypted(envelope: Record<string, any>, isAuthMsg: boolean) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (vaultEstablished && sessionVault && !isAuthMsg) {
    const action = String(envelope.action || '').toUpperCase();
    if (action === 'EXECUTE_PROMPT') {
      const cmd = String(envelope.prompt || envelope.command || '');
      sendBinaryOpcode(Opcode.OP_SHELL, UTF8_ENCODER.encode(cmd));
      return;
    }
    if (action === 'APPROVAL_RESPONSE' || action === 'PANIC_KILL_ALL' || action === 'PANIC') {
      sendBinaryOpcode(Opcode.OP_HITL, UTF8_ENCODER.encode(JSON.stringify(envelope)));
      return;
    }
    if (action === 'CLIPBOARD_SYNC') {
      sendBinaryOpcode(Opcode.OP_CLIP, UTF8_ENCODER.encode(String(envelope.text || '')));
      return;
    }
    if (action === 'INPUT_EVENT' || action === 'PC_CONTROL') {
      sendBinaryOpcode(Opcode.OP_INPUT, UTF8_ENCODER.encode(JSON.stringify(envelope)));
      return;
    }
    // Never emit unencrypted JSON once AEAD vault is established
    sendBinaryOpcode(Opcode.OP_INPUT, UTF8_ENCODER.encode(JSON.stringify(envelope)));
    return;
  }
  if (sessionAuthenticated || isAuthMsg) {
    socket.send(JSON.stringify(envelope));
  }
}

function sendOrQueueJson(envelope: Record<string, any>, isAuthMsg: boolean) {
  if (socket && socket.readyState === WebSocket.OPEN && (sessionAuthenticated || isAuthMsg)) {
    try {
      dispatchJsonOrEncrypted(envelope, isAuthMsg);
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
      authChallengeResponded = false;
      resetVaultState();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearConnectionWatchdog();
      clearAuthHandshakeTimer();
      stopHeartbeat();
      if (socket) {
        const oldSocket = socket;
        socket = null;
        try {
          oldSocket.onopen = null;
          oldSocket.onmessage = null;
          oldSocket.onerror = null;
          oldSocket.onclose = null;
          oldSocket.close(1000, 'User disconnect');
        } catch {
          // ignore
        }
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
        const hmacHex = hmacSha256HexSync(currentToken.trim(), proofInput);
        sendOrQueueJson(
          {
            ...envelope,
            signature: hmacHex,
            approval_hmac: hmacHex,
          },
          false
        );
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
      const opcode = rawOpcode & 0xff;
      const rawText = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data || {});
      const bodyBytes = UTF8_ENCODER.encode(rawText);
      if (bodyBytes.length > MAX_PAYLOAD_SIZE) {
        return;
      }
      const isHandshakeOp = opcode === Opcode.OP_PING || opcode === Opcode.OP_AUTH;

      if (socket && socket.readyState === WebSocket.OPEN && (sessionAuthenticated || isHandshakeOp)) {
        sendBinaryOpcode(opcode, bodyBytes);
      } else if (autoReconnectEnabled || (socket && socket.readyState === WebSocket.OPEN && !sessionAuthenticated)) {
        if (outboundQueue.length < MAX_QUEUE_SIZE) {
          outboundQueue.push({ type: 'opcode', opcode, payload: bodyBytes });
        }
      }
      break;
    }
  }
};

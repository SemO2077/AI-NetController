"""
AI NetController — Network Fuzzer Shield & Zero-Trust Connection State Guard
================================================================================
Implements:
  1. Toxic Proxy Simulation (Packet Loss 5%-15%, Latency Jitter up to 300ms, Out-of-Order Delivery)
  2. Strict Connection State Machine with Handshake Watchdog SLA Timer
  3. Ephemeral Key Zeroization & Bounded Client State Eviction
  4. Keyframe Resynchronization Signal Handling (Opcode 0xED)
================================================================================
"""

import asyncio
from collections import deque
import enum
import inspect
import logging
import random
import struct
from typing import Callable, Dict, List, Optional

logger = logging.getLogger("NetworkFuzzerShield")

# Binary Protocol Constants
MAGIC = b"\xC5\x71"
HEADER_STRUCT = struct.Struct("!2sBBII")
HEADER_SIZE = HEADER_STRUCT.size
MAX_PAYLOAD_SIZE = 10 * 1024 * 1024  # 10 MiB canonical frame ceiling

# Canonical Protocol Opcodes
OP_PING = 0x01
OP_TELEMETRY = 0x02
OP_FRAME = 0x03
OP_SHELL = 0x04
OP_HITL = 0x05
OP_AUTH = 0x06
OP_CLIP = 0x07
OP_INPUT = 0x08
OP_AUDIO = 0x09
OP_VIEWPORT_RESIZE = 0x0A
OP_LLM_STREAM = 0x0B
OP_FILE_TRANSFER = 0x0C
OP_DISPLAY_ENUM = 0x0D
OP_FRAME_SYNC = 0xED  # Keyframe resynchronization signal
OP_ERR = 0xEE

_PRE_AUTH_ALLOWED_OPCODES = {OP_PING, OP_AUTH}
_VIEWPORT_ALLOWED_OPCODES = {OP_PING, OP_AUTH, OP_VIEWPORT_RESIZE, OP_DISPLAY_ENUM}
_MAX_REORDER_BUFFER = 64
_MAX_TERMINATED_HISTORY = 256


class ConnectionState(enum.Enum):
    LISTENING = 1               # Socket created, awaiting incoming TCP/WS client
    CONNECTED = 2               # Client connected, initial banner/nonce challenge sent
    ECDH_EXCHANGED = 3          # Curve25519 public keys exchanged
    AUTH_PENDING = 4            # Awaiting HMAC-SHA256 proof or ChaCha20 handshake verification
    VIEWPORT_NEGOTIATING = 5    # Authenticated, dynamically matching display bounds
    AUTHENTICATED_STREAMING = 6 # Zero-Trust channel established; active streaming
    TERMINATED = 7              # Socket gracefully or forcefully closed; keys scrubbed


class ChaosProfile:
    """Configurable toxic network parameters for stress testing."""

    def __init__(
        self,
        enabled: bool = True,
        min_loss_pct: float = 5.0,
        max_loss_pct: float = 15.0,
        max_jitter_ms: float = 300.0,
        reorder_prob_pct: float = 8.0,
        handshake_timeout_sec: float = 3.0,
    ):
        self.enabled = enabled
        self.min_loss_pct = min_loss_pct
        self.max_loss_pct = max_loss_pct
        self.max_jitter_ms = max_jitter_ms
        self.reorder_prob_pct = reorder_prob_pct
        self.handshake_timeout_sec = handshake_timeout_sec

    def should_drop(self) -> bool:
        if not self.enabled:
            return False
        loss_threshold = random.uniform(self.min_loss_pct, self.max_loss_pct)
        return random.uniform(0, 100) < loss_threshold

    def get_jitter_delay_seconds(self) -> float:
        if not self.enabled:
            return 0.0
        return random.uniform(0.010, self.max_jitter_ms / 1000.0)

    def should_reorder(self) -> bool:
        if not self.enabled:
            return False
        return random.uniform(0, 100) < self.reorder_prob_pct


def scrub_bytes(data: Optional[bytearray]) -> None:
    """Secure in-place zeroization of ephemeral keys from RAM."""
    if data is not None and isinstance(data, bytearray):
        for i in range(len(data)):
            data[i] = 0


class NetworkFuzzerShield:
    """
    Enforces strict per-client connection state transitions, handshake timeout SLAs,
    ephemeral key zeroization, and optional chaos fault injection.
    """

    def __init__(self, chaos_profile: Optional[ChaosProfile] = None):
        self.profile = chaos_profile or ChaosProfile()
        self.client_states: Dict[str, ConnectionState] = {}
        self.watchdogs: Dict[str, asyncio.Task] = {}
        self.ephemeral_keys: Dict[str, bytearray] = {}
        self.stats = {
            "packets_inspected": 0,
            "packets_dropped": 0,
            "packets_jittered": 0,
            "packets_reordered": 0,
            "packets_rejected_state": 0,
            "watchdog_timeouts": 0,
            "sync_requests_handled": 0,
        }
        self._reorder_buffer: Dict[str, list] = {}
        self._terminated_order: deque = deque()

    def register_client(self, client_id: str, close_callback: Callable) -> None:
        """Registers a client and arms the handshake watchdog SLA timer."""
        old_wd = self.watchdogs.pop(client_id, None)
        if old_wd and not old_wd.done():
            old_wd.cancel()
        old_key = self.ephemeral_keys.pop(client_id, None)
        if old_key:
            scrub_bytes(old_key)

        self.client_states[client_id] = ConnectionState.CONNECTED
        self._reorder_buffer[client_id] = []
        logger.info("Client %s entered %s. Arming %.1fs watchdog.", client_id, ConnectionState.CONNECTED.name, self.profile.handshake_timeout_sec)

        watchdog_task = asyncio.create_task(
            self._handshake_watchdog(client_id, close_callback)
        )
        self.watchdogs[client_id] = watchdog_task

    def store_ephemeral_key(self, client_id: str, key_bytes: bytes) -> None:
        """Stores ephemeral session key in a mutable bytearray for secure scrubbing."""
        prev = self.ephemeral_keys.get(client_id)
        if prev:
            scrub_bytes(prev)
        self.ephemeral_keys[client_id] = bytearray(key_bytes)

    def transition_state(self, client_id: str, next_state: ConnectionState) -> bool:
        """Validates and applies strict state transitions."""
        current = self.client_states.get(client_id, ConnectionState.LISTENING)
        valid = False

        if current == ConnectionState.CONNECTED and next_state in (ConnectionState.ECDH_EXCHANGED, ConnectionState.AUTH_PENDING):
            valid = True
        elif current == ConnectionState.ECDH_EXCHANGED and next_state == ConnectionState.AUTH_PENDING:
            valid = True
        elif current == ConnectionState.AUTH_PENDING and next_state in (ConnectionState.VIEWPORT_NEGOTIATING, ConnectionState.AUTHENTICATED_STREAMING):
            valid = True
        elif current == ConnectionState.VIEWPORT_NEGOTIATING and next_state == ConnectionState.AUTHENTICATED_STREAMING:
            valid = True
        elif next_state == ConnectionState.TERMINATED:
            valid = True

        if not valid:
            logger.error("Illegal state transition for %s: %s -> %s", client_id, current.name, next_state.name)
            return False

        self.client_states[client_id] = next_state
        logger.info("Client %s transitioned: %s -> %s", client_id, current.name, next_state.name)

        if next_state == ConnectionState.AUTHENTICATED_STREAMING:
            wd = self.watchdogs.pop(client_id, None)
            if wd and not wd.done():
                wd.cancel()
                logger.info("Handshake complete for %s. Watchdog disarmed.", client_id)

        return True

    async def _handshake_watchdog(self, client_id: str, close_callback: Callable) -> None:
        """Terminates stalled clients that do not authenticate within SLA."""
        try:
            await asyncio.sleep(self.profile.handshake_timeout_sec)
            state = self.client_states.get(client_id, ConnectionState.LISTENING)
            if state != ConnectionState.AUTHENTICATED_STREAMING:
                logger.warning(
                    "HANDSHAKE SLA BREACH: Client %s stalled in %s after %.2fs; terminating.",
                    client_id,
                    state.name,
                    self.profile.handshake_timeout_sec,
                )
                self.stats["watchdog_timeouts"] += 1
                await self.cleanup_and_scrub(
                    client_id,
                    close_callback,
                    reason="Handshake watchdog timeout",
                )
        except asyncio.CancelledError:
            pass

    async def cleanup_and_scrub(
        self,
        client_id: str,
        close_callback: Optional[Callable] = None,
        reason: str = "",
    ) -> None:
        """Terminates client, zeroizes in-memory keys, and bounds history state."""
        logger.info("Cleaning up and zeroizing keys for %s. Reason: %s", client_id, reason)

        wd = self.watchdogs.pop(client_id, None)
        if wd and not wd.done() and wd is not asyncio.current_task():
            wd.cancel()
            try:
                await asyncio.gather(wd, return_exceptions=True)
            except Exception:
                pass

        key = self.ephemeral_keys.pop(client_id, None)
        if key:
            scrub_bytes(key)
            logger.debug("Ephemeral key for %s scrubbed from RAM.", client_id)

        self.client_states[client_id] = ConnectionState.TERMINATED
        self._terminated_order.append(client_id)
        while len(self._terminated_order) > _MAX_TERMINATED_HISTORY:
            old_id = self._terminated_order.popleft()
            if self.client_states.get(old_id) == ConnectionState.TERMINATED and old_id != client_id:
                self.client_states.pop(old_id, None)

        self._reorder_buffer.pop(client_id, None)

        if close_callback:
            try:
                res = close_callback()
                if inspect.isawaitable(res):
                    await res
            except Exception as e:
                logger.error("Error invoking close callback for %s: %s", client_id, e)

    async def filter_incoming_packet(
        self,
        client_id: str,
        raw_packet: bytes,
        on_keyframe_request: Optional[Callable] = None,
    ) -> Optional[bytes]:
        """
        Enforces ConnectionState opcode gate, handles keyframe resync (0xED),
        and optionally applies chaos simulation (drop, jitter, reorder).
        """
        self.stats["packets_inspected"] += 1

        if len(raw_packet) < HEADER_SIZE:
            return None

        magic, opcode, flags, seq, length = HEADER_STRUCT.unpack_from(raw_packet, 0)
        if magic != MAGIC or length > MAX_PAYLOAD_SIZE or len(raw_packet) != HEADER_SIZE + length:
            return None

        # Strictly enforce state machine before processing or passing packets through
        state = self.client_states.get(client_id)
        if state == ConnectionState.TERMINATED:
            self.stats["packets_rejected_state"] += 1
            return None
        if state in (ConnectionState.CONNECTED, ConnectionState.ECDH_EXCHANGED, ConnectionState.AUTH_PENDING):
            if opcode not in _PRE_AUTH_ALLOWED_OPCODES:
                self.stats["packets_rejected_state"] += 1
                logger.warning("Rejected pre-auth opcode 0x%02X from %s in state %s", opcode, client_id, state.name)
                return None
        elif state == ConnectionState.VIEWPORT_NEGOTIATING:
            if opcode not in _VIEWPORT_ALLOWED_OPCODES:
                self.stats["packets_rejected_state"] += 1
                logger.warning("Rejected opcode 0x%02X from %s during %s", opcode, client_id, state.name)
                return None

        # Handle Frame Resync Request (Opcode 0xED)
        if opcode == OP_FRAME_SYNC:
            logger.info("Opcode 0xED (Frame Sync) received from %s", client_id)
            self.stats["sync_requests_handled"] += 1
            if on_keyframe_request:
                try:
                    res = on_keyframe_request(client_id)
                    if inspect.isawaitable(res):
                        await res
                except Exception as e:
                    logger.error("Error handling keyframe sync: %s", e)
            return None

        if not self.profile.enabled:
            return raw_packet

        # Chaos Drop Simulation
        if self.profile.should_drop():
            self.stats["packets_dropped"] += 1
            return None

        # Chaos Jitter Simulation
        delay = self.profile.get_jitter_delay_seconds()
        if delay > 0:
            self.stats["packets_jittered"] += 1
            await asyncio.sleep(delay)

        # Chaos Reordering Simulation (bounded)
        buf = self._reorder_buffer.setdefault(client_id, [])
        if self.profile.should_reorder():
            self.stats["packets_reordered"] += 1
            buf.append(raw_packet)
            if len(buf) >= _MAX_REORDER_BUFFER:
                return buf.pop(0)
            if len(buf) >= 2:
                p1 = buf.pop(0)
                p2 = buf.pop(0)
                buf.insert(0, p1)
                return p2
            return None

        if buf:
            delayed = buf.pop(0)
            buf.append(raw_packet)
            return delayed

        return raw_packet

    def flush_reorder_buffer(self, client_id: str) -> List[bytes]:
        """Drains and clears any queued reordered packets for the specified client."""
        buf = self._reorder_buffer.pop(client_id, None)
        if not buf:
            return []
        drained = list(buf)
        buf.clear()
        return drained

    def get_audit_metrics(self) -> dict:
        """Returns runtime shield metrics."""
        active_count = sum(
            1 for state in self.client_states.values()
            if state != ConnectionState.TERMINATED
        )
        return {
            **self.stats,
            "active_clients": active_count,
            "profile_active": self.profile.enabled,
        }

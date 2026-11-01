"""
CST Capstone Project - Gold Master Enterprise Release
Network Fuzzer Shield & Chaos Engineering Simulation Suite
================================================================================
Architected for Formal Verification, Zero-Trust Hardening, and SRE Chaos Testing.
Implements:
  1. Toxic Proxy Simulation (Packet Loss 5%-15%, Latency Jitter up to 300ms, Out-of-Order Delivery)
  2. Strict State Machine Deadlock Prevention with 3000ms Watchdog Handshake Timer
  3. Ephemeral Key Zeroization & Memory Scrubbing on Handshake Abort
  4. Automatic Recovery & Keyframe Sync (Opcode 0xEE)
================================================================================
"""

import asyncio
import enum
import logging
import os
import random
import struct
import sys
import time
from typing import Dict, Optional, Set, Tuple, Callable

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [Chaos-Shield] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("NetworkFuzzerShield")

# Binary Protocol Constants
MAGIC = b'\xC5\x71'
HEADER_STRUCT = struct.Struct('!2sBBII')
HEADER_SIZE = HEADER_STRUCT.size

# Protocol Opcodes
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
OP_FRAME_SYNC = 0xEE  # Keyframe resynchronization signal


# ==============================================================================
# STATE MACHINE DEFINITIONS (STRICT EXHAUSTIVE ENUM)
# ==============================================================================
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


# ==============================================================================
# MEMORY SCRUBBING UTILITY
# ==============================================================================
def scrub_bytes(data: Optional[bytearray]):
    """Secure in-place zeroization of ephemeral keys from RAM."""
    if data is not None and isinstance(data, bytearray):
        for i in range(len(data)):
            data[i] = 0


# ==============================================================================
# SRE NETWORK FUZZER & WATCHDOG SHIELD
# ==============================================================================
class NetworkFuzzerShield:
    """
    Wraps raw client connections with chaos network fault injection
    and enforces a strict 3000ms handshake watchdog.
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
            "watchdog_timeouts": 0,
            "sync_requests_handled": 0
        }
        self._reorder_buffer: Dict[str, list] = {}

    def register_client(self, client_id: str, close_callback: Callable):
        """Registers a new client and arms the strict 3000ms handshake watchdog."""
        self.client_states[client_id] = ConnectionState.CONNECTED
        self._reorder_buffer[client_id] = []
        logger.info(f"Client {client_id} entered state {ConnectionState.CONNECTED.name}. Arming 3000ms watchdog.")

        # Arm global 3000ms watchdog
        watchdog_task = asyncio.create_task(
            self._handshake_watchdog(client_id, close_callback)
        )
        self.watchdogs[client_id] = watchdog_task

    def store_ephemeral_key(self, client_id: str, key_bytes: bytes):
        """Stores ephemeral session key in a mutable bytearray for secure scrubbing."""
        self.ephemeral_keys[client_id] = bytearray(key_bytes)

    def transition_state(self, client_id: str, next_state: ConnectionState):
        """Strict state transitions ensuring valid progression."""
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
            logger.error(f"Illegal state transition requested for {client_id}: {current.name} -> {next_state.name}!")
            return False

        self.client_states[client_id] = next_state
        logger.info(f"Client {client_id} transitioned: {current.name} -> {next_state.name}")

        # Disarm watchdog once authenticated
        if next_state == ConnectionState.AUTHENTICATED_STREAMING:
            wd = self.watchdogs.pop(client_id, None)
            if wd and not wd.done():
                wd.cancel()
                logger.info(f"Handshake complete for {client_id} within SLA. Watchdog disarmed.")

        return True

    async def _handshake_watchdog(self, client_id: str, close_callback: Callable):
        """Enforces a strict 3000ms SLA for the cryptographic handshake."""
        try:
            await asyncio.sleep(self.profile.handshake_timeout_sec)
            state = self.client_states.get(client_id, ConnectionState.LISTENING)
            if state != ConnectionState.AUTHENTICATED_STREAMING:
                logger.warning(
                    f"HANDSHAKE SLA BREACH: Client {client_id} stalled in {state.name} "
                    f"after {self.profile.handshake_timeout_sec}s! Executing force termination."
                )
                self.stats["watchdog_timeouts"] += 1
                await self.cleanup_and_scrub(client_id, close_callback, reason="Handshake watchdog timeout (3000ms)")
        except asyncio.CancelledError:
            pass

    async def cleanup_and_scrub(self, client_id: str, close_callback: Optional[Callable] = None, reason: str = ""):
        """Forcefully terminates client, zeroes in-memory keys, and resets state."""
        logger.info(f"Cleaning up and zeroizing keys for {client_id}. Reason: {reason}")
        
        # 1. Disarm watchdog
        wd = self.watchdogs.pop(client_id, None)
        if wd and not wd.done():
            wd.cancel()

        # 2. Scrub ephemeral keys
        key = self.ephemeral_keys.pop(client_id, None)
        if key:
            scrub_bytes(key)
            logger.debug(f"Ephemeral keys for {client_id} scrubbed from RAM.")

        # 3. Transition to terminated
        self.client_states[client_id] = ConnectionState.TERMINATED
        self._reorder_buffer.pop(client_id, None)

        # 4. Invoke socket closer
        if close_callback:
            try:
                res = close_callback()
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                logger.error(f"Error invoking close callback for {client_id}: {e}")

    async def filter_incoming_packet(
        self,
        client_id: str,
        raw_packet: bytes,
        on_keyframe_request: Optional[Callable] = None
    ) -> Optional[bytes]:
        """
        Applies chaos simulation: packet drops, latency jitter, and reordering.
        Detects Opcode 0xEE (Frame Sync) to trigger instant keyframe regeneration.
        """
        self.stats["packets_inspected"] += 1

        if len(raw_packet) < HEADER_SIZE:
            return raw_packet

        # Parse header
        magic, opcode, flags, seq, length = HEADER_STRUCT.unpack_from(raw_packet, 0)
        if magic != MAGIC:
            return raw_packet

        # Handle Frame Resync Request (Opcode 0xEE)
        if opcode == OP_FRAME_SYNC:
            logger.warning(f"Opcode 0xEE (Frame Sync) received from {client_id}. Client experienced dropped chunk.")
            self.stats["sync_requests_handled"] += 1
            if on_keyframe_request:
                try:
                    res = on_keyframe_request(client_id)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception as e:
                    logger.error(f"Error handling keyframe sync: {e}")
            return None  # Absorbed internally

        # Apply Packet Drop Simulation
        if self.profile.should_drop():
            self.stats["packets_dropped"] += 1
            logger.debug(f"[CHAOS INJECTION] Dropping packet opcode 0x{opcode:02X} seq {seq} for {client_id}")
            return None

        # Apply Latency Jitter Simulation
        delay = self.profile.get_jitter_delay_seconds()
        if delay > 0:
            self.stats["packets_jittered"] += 1
            await asyncio.sleep(delay)

        # Apply Out-of-Order Reordering Simulation
        if self.profile.should_reorder():
            self.stats["packets_reordered"] += 1
            buf = self._reorder_buffer.setdefault(client_id, [])
            buf.append(raw_packet)
            if len(buf) >= 2:
                # Swap order of buffered packets: return p2 now, keep p1 for next delivery
                p1 = buf.pop(0)
                p2 = buf.pop(0)
                buf.insert(0, p1)
                return p2
            return None

        # Deliver any buffered reordered packet before incoming packet
        buf = self._reorder_buffer.get(client_id)
        if buf and len(buf) > 0:
            delayed = buf.pop(0)
            buf.append(raw_packet)
            return delayed

        return raw_packet

    def get_audit_metrics(self) -> dict:
        """Returns runtime SRE chaos metrics."""
        active_count = sum(
            1 for state in self.client_states.values()
            if state != ConnectionState.TERMINATED
        )
        return {
            **self.stats,
            "active_clients": active_count,
            "profile_active": self.profile.enabled
        }

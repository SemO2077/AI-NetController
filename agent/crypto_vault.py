"""
Hardened Cryptographic Engine & Zero-Trust Protocol Pipeline
================================================================================
RFC 7748 (Curve25519 / X25519 Ephemeral ECDH)
RFC 5869 (HKDF-SHA256 Key Derivation - Twin Directional Session Keys)
RFC 8439 (ChaCha20-Poly1305 AEAD Authenticated Encryption with Associated Data)
RFC 6479 (High-Throughput 128-bit Sliding Window Anti-Replay Engine)
Constant-Time Validation & In-Memory Zeroization Scrubbing
================================================================================
"""

import hmac
import struct
import secrets
import hashlib
import ctypes
from typing import Tuple, Optional, Union, Any

# Try hardware-accelerated cryptography primitives; fallback to pure-Python
try:
    from cryptography.hazmat.primitives.asymmetric import x25519
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
    HAS_CRYPTOGRAPHY_ACCEL = True
except ImportError:
    HAS_CRYPTOGRAPHY_ACCEL = False

# Cryptographic Constants
KEY_SIZE = 32           # 256-bit symmetric key
NONCE_SIZE = 12         # 96-bit ChaCha20 nonce (4-byte salt/epoch + 8-byte monotonic counter)
TAG_SIZE = 16           # 128-bit Poly1305 authentication tag
SALT_SIZE = 16          # 128-bit HKDF ephemeral salt
WINDOW_SIZE = 128       # RFC 6479 Sliding Window Bitmask size (bits)

CTX_HOST_TX = b"cst-host-tx"
CTX_CLIENT_TX = b"cst-client-tx"
PROTOCOL_MAGIC = b"CST_ECDH_V2"

# ------------------------------------------------------------------------------
# Secure Memory Scrubbing (In-Place Zeroization)
# ------------------------------------------------------------------------------
def scrub_memory(buf: Union[bytearray, memoryview, bytes, ctypes.Array]):
    """
    Overwrites sensitive cryptographic buffers in physical RAM to prevent
    cold-boot, memory-dump, and heap-inspection attacks.
    """
    if isinstance(buf, bytearray):
        for i in range(len(buf)):
            buf[i] = 0
    elif isinstance(buf, memoryview) and not buf.readonly:
        buf[:len(buf)] = b'\x00' * len(buf)
    elif isinstance(buf, ctypes.Array):
        ctypes.memset(ctypes.addressof(buf), 0, ctypes.sizeof(buf))

# ------------------------------------------------------------------------------
# RFC 6479 Sliding-Window Anti-Replay Protection
# ------------------------------------------------------------------------------
class SlidingWindowReplayProtector:
    """
    RFC 6479 Bitmap Sliding Window Replay Protection (128-bit capacity).
    Permits legitimate out-of-order packet arrival over multi-path Wi-Fi
    while strictly dropping duplicate packets and backward-skewed nonces.
    """
    def __init__(self, window_size: int = 128):
        self.window_size = window_size
        self.max_seq: int = 0
        # 128-bit bitmask represented by two 64-bit unsigned integers
        self.bitmap: int = 0
        self.initialized = False

    def check(self, seq: int) -> bool:
        """Validates sequence without updating window state (prevents DoS before MAC auth)."""
        if seq <= 0:
            return False
        if not self.initialized:
            return True
        diff = seq - self.max_seq
        if diff > 0:
            return True
        abs_diff = -diff
        if abs_diff >= self.window_size:
            return False
        bit_mask = 1 << abs_diff
        return (self.bitmap & bit_mask) == 0

    def update(self, seq: int):
        """Commits verified sequence number into window state after successful decryption."""
        self.validate_and_update(seq)

    def validate_and_update(self, seq: int) -> bool:
        """
        Validates sequence number against sliding window.
        Returns True if sequence is fresh and valid; False if replay/too old.
        Rejects seq <= 0 as invalid (sequence numbers must be positive).
        """
        if seq <= 0:
            return False

        if not self.initialized:
            self.max_seq = seq
            self.bitmap = 1
            self.initialized = True
            return True

        diff = seq - self.max_seq

        if diff > 0:
            # Newer packet ahead of window
            if diff < self.window_size:
                self.bitmap = (self.bitmap << diff) | 1
            else:
                # Sequence jumped past entire window
                self.bitmap = 1
            self.max_seq = seq
            # Mask to 128 bits
            self.bitmap &= (1 << self.window_size) - 1
            return True
        else:
            # Older or duplicate packet
            abs_diff = -diff
            if abs_diff >= self.window_size:
                # Dropped off the left edge of the sliding window
                return False
            # Check bit at position abs_diff
            bit_mask = 1 << abs_diff
            if (self.bitmap & bit_mask) != 0:
                # Already received (Replay Attack)
                return False
            # Mark bit in window
            self.bitmap |= bit_mask
            return True

# ------------------------------------------------------------------------------
# Pure-Python RFC 7748 Curve25519 Engine
# ------------------------------------------------------------------------------
_P = 2**255 - 19
_A24 = 121665

def _clamp_scalar(k_bytes: bytes) -> int:
    a = bytearray(k_bytes)
    a[0] &= 248
    a[31] &= 127
    a[31] |= 64
    val = int.from_bytes(a, 'little')
    scrub_memory(a)
    return val

def _x25519_eval(k: int, u: int) -> int:
    x_1 = u & ((1 << 255) - 1)
    x_2, z_2 = 1, 0
    x_3, z_3 = x_1, 1
    swap = 0

    for t in reversed(range(255)):
        k_t = (k >> t) & 1
        swap ^= k_t
        mask = -swap
        dx = mask & (x_2 ^ x_3)
        x_2 ^= dx
        x_3 ^= dx
        dz = mask & (z_2 ^ z_3)
        z_2 ^= dz
        z_3 ^= dz
        swap = k_t

        A = (x_2 + z_2) % _P
        AA = (A * A) % _P
        B = (x_2 - z_2) % _P
        BB = (B * B) % _P
        E = (AA - BB) % _P
        C = (x_3 + z_3) % _P
        D = (x_3 - z_3) % _P
        DA = (D * A) % _P
        CB = (C * B) % _P
        x_3 = ((DA + CB) ** 2) % _P
        z_3 = (x_1 * ((DA - CB) ** 2)) % _P
        x_2 = (AA * BB) % _P
        z_2 = (E * (AA + _A24 * E)) % _P

    mask = -swap
    dx = mask & (x_2 ^ x_3)
    x_2 ^= dx
    x_3 ^= dx
    dz = mask & (z_2 ^ z_3)
    z_2 ^= dz
    z_3 ^= dz

    return (x_2 * pow(z_2, _P - 2, _P)) % _P

class FallbackCurve25519:
    @staticmethod
    def generate_keypair() -> Tuple[bytes, bytes]:
        priv = secrets.token_bytes(32)
        k = _clamp_scalar(priv)
        pub_int = _x25519_eval(k, 9)
        pub = pub_int.to_bytes(32, 'little')
        return priv, pub

    @staticmethod
    def compute_shared_secret(priv: bytes, peer_pub: bytes) -> bytes:
        k = _clamp_scalar(priv)
        u = int.from_bytes(peer_pub, 'little')
        shared_int = _x25519_eval(k, u)
        return shared_int.to_bytes(32, 'little')

# ------------------------------------------------------------------------------
# Pure-Python RFC 8439 ChaCha20-Poly1305 Engine
# ------------------------------------------------------------------------------
def _rotl32(v: int, c: int) -> int:
    return ((v << c) & 0xFFFFFFFF) | (v >> (32 - c))

def _chacha_quarter_round(x: list, a: int, b: int, c: int, d: int):
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 16)
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 12)
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 8)
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 7)

def _chacha20_block(key: bytes, counter: int, nonce: bytes) -> bytes:
    constants = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]
    k = list(struct.unpack("<8I", key))
    n = list(struct.unpack("<3I", nonce))
    state = constants + k + [counter] + n
    working = list(state)
    for _ in range(10):
        # Column round
        _chacha_quarter_round(working, 0, 4, 8, 12)
        _chacha_quarter_round(working, 1, 5, 9, 13)
        _chacha_quarter_round(working, 2, 6, 10, 14)
        _chacha_quarter_round(working, 3, 7, 11, 15)
        # Diagonal round
        _chacha_quarter_round(working, 0, 5, 10, 15)
        _chacha_quarter_round(working, 1, 6, 11, 12)
        _chacha_quarter_round(working, 2, 7, 8, 13)
        _chacha_quarter_round(working, 3, 4, 9, 14)
    out = bytearray(64)
    for i in range(16):
        struct.pack_into("<I", out, i * 4, (working[i] + state[i]) & 0xFFFFFFFF)
    return bytes(out)

def _chacha20_stream(key: bytes, nonce: bytes, initial_counter: int, length: int) -> bytes:
    blocks = []
    ctr = initial_counter
    bytes_left = length
    while bytes_left > 0:
        blk = _chacha20_block(key, ctr, nonce)
        blocks.append(blk[:bytes_left])
        bytes_left -= len(blk)
        ctr += 1
    return b"".join(blocks)

def _poly1305_mac(msg: bytes, key: bytes) -> bytes:
    r_bytes = key[:16]
    s_bytes = key[16:32]
    r = int.from_bytes(r_bytes, 'little')
    r &= 0x0ffffffc0fffffff0ffffffc0fffffff
    s = int.from_bytes(s_bytes, 'little')
    p = (1 << 130) - 5
    accumulator = 0

    for i in range(0, len(msg), 16):
        chunk = msg[i:i + 16]
        val = int.from_bytes(chunk, 'little') + (1 << (len(chunk) * 8))
        accumulator = ((accumulator + val) * r) % p

    accumulator = (accumulator + s) % (1 << 128)
    return accumulator.to_bytes(16, 'little')

class FallbackChaCha20Poly1305:
    @staticmethod
    def _xor_bytes(data: bytes, stream: bytes) -> bytes:
        if not data:
            return b""
        n = len(data)
        return (int.from_bytes(data, "little") ^ int.from_bytes(stream[:n], "little")).to_bytes(n, "little")

    @staticmethod
    def encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
        poly_key_block = _chacha20_block(key, 0, nonce)
        poly_key = poly_key_block[:32]
        stream = _chacha20_stream(key, nonce, 1, len(plaintext))
        ciphertext = FallbackChaCha20Poly1305._xor_bytes(plaintext, stream)

        mac_data = bytearray()
        mac_data.extend(aad)
        if len(aad) % 16 != 0:
            mac_data.extend(b"\x00" * (16 - (len(aad) % 16)))
        mac_data.extend(ciphertext)
        if len(ciphertext) % 16 != 0:
            mac_data.extend(b"\x00" * (16 - (len(ciphertext) % 16)))
        mac_data.extend(struct.pack("<QQ", len(aad), len(ciphertext)))

        tag = _poly1305_mac(bytes(mac_data), poly_key)
        return ciphertext + tag

    @staticmethod
    def decrypt(key: bytes, nonce: bytes, ciphertext_and_tag: bytes, aad: bytes = b"") -> Optional[bytes]:
        if len(ciphertext_and_tag) < 16:
            return None
        ciphertext = ciphertext_and_tag[:-16]
        expected_tag = ciphertext_and_tag[-16:]

        poly_key_block = _chacha20_block(key, 0, nonce)
        poly_key = poly_key_block[:32]

        mac_data = bytearray()
        mac_data.extend(aad)
        if len(aad) % 16 != 0:
            mac_data.extend(b"\x00" * (16 - (len(aad) % 16)))
        mac_data.extend(ciphertext)
        if len(ciphertext) % 16 != 0:
            mac_data.extend(b"\x00" * (16 - (len(ciphertext) % 16)))
        mac_data.extend(struct.pack("<QQ", len(aad), len(ciphertext)))

        computed_tag = _poly1305_mac(bytes(mac_data), poly_key)
        if not hmac.compare_digest(computed_tag, expected_tag):
            return None

        stream = _chacha20_stream(key, nonce, 1, len(ciphertext))
        return FallbackChaCha20Poly1305._xor_bytes(ciphertext, stream)

# ------------------------------------------------------------------------------
# HKDF-SHA256 Key Derivation Function (RFC 5869)
# ------------------------------------------------------------------------------
def hkdf_extract_and_expand(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    if HAS_CRYPTOGRAPHY_ACCEL:
        hkdf = HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info)
        return hkdf.derive(ikm)
    # Pure Python RFC 5869
    prk = hmac.new(salt if salt else b"\x00" * 32, ikm, hashlib.sha256).digest()
    t = b""
    okm = b""
    for i in range(1, ((length + 31) // 32) + 1):
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t
    return okm[:length]

# ------------------------------------------------------------------------------
# Hardened Host Crypto Vault Session Manager
# ------------------------------------------------------------------------------
class HostCryptoVault:
    """
    Host-side authenticated zero-trust session engine.
    Manages twin directional keys (TX/RX) and sliding anti-replay window.
    """
    def __init__(self, psk_secret: bytes):
        if not psk_secret or len(psk_secret) == 0:
            raise ValueError("Pre-shared key (PSK) must not be empty.")
        self.psk: Optional[bytearray] = bytearray(psk_secret)
        self.k_send: Optional[bytearray] = None
        self.k_recv: Optional[bytearray] = None
        self._send_cipher: Optional[Any] = None
        self._recv_cipher: Optional[Any] = None
        self.is_established: bool = False
        self._closed: bool = False
        self.tx_seq: int = 0
        self.replay_guard = SlidingWindowReplayProtector(WINDOW_SIZE)

        # Generate ephemeral ECDH keypair
        if HAS_CRYPTOGRAPHY_ACCEL:
            self._priv_obj = x25519.X25519PrivateKey.generate()
            self._pub_bytes = self._priv_obj.public_key().public_bytes_raw()
            self._priv_bytes: Optional[bytearray] = None
        else:
            priv_b, pub_b = FallbackCurve25519.generate_keypair()
            self._priv_bytes = bytearray(priv_b)
            self._pub_bytes = pub_b
            self._priv_obj = None

        self.host_nonce_n2 = secrets.token_bytes(SALT_SIZE)

    def create_handshake_challenge(self) -> bytes:
        """
        Creates Opcode 0x06 Handshake Payload:
        [11B MAGIC] [32B HOST_PUBKEY] [16B NONCE_N2]
        """
        if self._closed:
            raise RuntimeError("HostCryptoVault has been closed.")
        payload = bytearray()
        payload.extend(PROTOCOL_MAGIC)
        payload.extend(self._pub_bytes)
        payload.extend(self.host_nonce_n2)
        return bytes(payload)

    def complete_handshake(self, client_payload: bytes) -> bool:
        """
        Processes Client Handshake:
        [32B CLIENT_PUBKEY] [16B CLIENT_NONCE_N1] [32B HMAC_PROOF]
        Validates PSK knowledge in constant-time and computes twin session keys.
        """
        if self._closed or self.is_established or not self.psk:
            return False
        if len(client_payload) < 80:
            return False

        client_pub = client_payload[:32]
        client_n1 = client_payload[32:48]
        client_hmac = client_payload[48:80]

        # Constant-time verification of pre-shared key knowledge
        proof_data = PROTOCOL_MAGIC + self._pub_bytes + client_pub + client_n1 + self.host_nonce_n2
        expected_hmac = hmac.new(bytes(self.psk), proof_data, hashlib.sha256).digest()

        if not hmac.compare_digest(client_hmac, expected_hmac):
            return False

        # Compute X25519 Shared Secret
        try:
            if HAS_CRYPTOGRAPHY_ACCEL and self._priv_obj:
                peer_pub_obj = x25519.X25519PublicKey.from_public_bytes(client_pub)
                shared_secret = bytearray(self._priv_obj.exchange(peer_pub_obj))
            elif self._priv_bytes is not None:
                shared_secret = bytearray(FallbackCurve25519.compute_shared_secret(bytes(self._priv_bytes), client_pub))
            else:
                return False
        except Exception:
            return False

        # RFC 7748 low-order point check: reject all-zero shared secret
        if hmac.compare_digest(bytes(shared_secret), b"\x00" * 32):
            scrub_memory(shared_secret)
            return False

        salt = client_n1 + self.host_nonce_n2

        # Derive Twin Symmetric Keys (Separation of Send & Receive keys)
        host_tx = hkdf_extract_and_expand(salt, bytes(shared_secret), CTX_HOST_TX, KEY_SIZE)
        host_rx = hkdf_extract_and_expand(salt, bytes(shared_secret), CTX_CLIENT_TX, KEY_SIZE)

        self.k_send = bytearray(host_tx)
        self.k_recv = bytearray(host_rx)
        if HAS_CRYPTOGRAPHY_ACCEL:
            self._send_cipher = ChaCha20Poly1305(bytes(self.k_send))
            self._recv_cipher = ChaCha20Poly1305(bytes(self.k_recv))
        self.is_established = True

        # Secure zeroization of intermediate ephemeral secret and private key material
        scrub_memory(shared_secret)
        self._priv_obj = None
        if self._priv_bytes is not None:
            scrub_memory(self._priv_bytes)
            self._priv_bytes = None

        return True

    def encrypt_frame(self, plaintext: bytes, aad: bytes = b"", seq: Optional[int] = None) -> Tuple[bytes, int]:
        """
        Encrypts an outgoing binary frame with ChaCha20-Poly1305.
        Enforces strictly monotonic positive sequence numbers to prevent nonce reuse.
        """
        if self._closed or not self.is_established or not self.k_send:
            raise RuntimeError("Cryptographic handshake has not been established or vault is closed.")

        if seq is None:
            self.tx_seq += 1
            seq = self.tx_seq
        else:
            if not isinstance(seq, int) or isinstance(seq, bool) or seq <= self.tx_seq or seq <= 0:
                raise ValueError("Sequence number must be a strictly increasing positive integer to prevent nonce reuse.")
            self.tx_seq = seq

        # Nonce format: 4 zero bytes + 8-byte big-endian sequence
        nonce = struct.pack(">IQ", 0, seq)

        if self._send_cipher is not None:
            ct = self._send_cipher.encrypt(nonce, plaintext, aad)
        else:
            ct = FallbackChaCha20Poly1305.encrypt(bytes(self.k_send), nonce, plaintext, aad)

        return nonce + ct, seq

    def decrypt_frame(self, framed_payload: bytes, aad: bytes = b"") -> Optional[Tuple[bytes, int]]:
        """
        Decrypts an incoming frame. Verifies AEAD tag and checks sequence number
        against RFC 6479 sliding replay window.
        """
        if self._closed or not self.is_established or not self.k_recv or len(framed_payload) < 28:
            return None

        nonce = framed_payload[:12]
        ciphertext_and_tag = framed_payload[12:]

        _, seq = struct.unpack(">IQ", nonce)

        # 1. Sliding window check without mutating state
        if not self.replay_guard.check(seq):
            return None

        # 2. Authenticate MAC and decrypt payload
        try:
            if self._recv_cipher is not None:
                plaintext = self._recv_cipher.decrypt(nonce, ciphertext_and_tag, aad)
            else:
                plaintext = FallbackChaCha20Poly1305.decrypt(bytes(self.k_recv), nonce, ciphertext_and_tag, aad)
            if plaintext is None:
                return None
            # 3. Commit into window state only after MAC verification succeeds
            self.replay_guard.update(seq)
            return plaintext, seq
        except Exception:
            return None

    def close(self):
        """Zeroizes all keys and permanently seals this vault instance."""
        self._closed = True
        if self.k_send is not None:
            scrub_memory(self.k_send)
            self.k_send = None
        if self.k_recv is not None:
            scrub_memory(self.k_recv)
            self.k_recv = None
        if self.psk is not None:
            scrub_memory(self.psk)
            self.psk = None
        if self._priv_bytes is not None:
            scrub_memory(self._priv_bytes)
            self._priv_bytes = None
        self._priv_obj = None
        self._send_cipher = None
        self._recv_cipher = None
        self.is_established = False

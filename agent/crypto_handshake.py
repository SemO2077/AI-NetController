"""
Zero-Trust Cryptographic Channel & Ephemeral ECDH Handshake
---------------------------------------------------------------------
Implements:
- Curve25519 (X25519) Ephemeral Key Agreement (Perfect Forward Secrecy)
- HKDF-SHA256 (RFC 5869) Key Derivation
- ChaCha20-Poly1305 AEAD (RFC 8439) Authenticated Encryption with Associated Data
- Opcode 0x06 Handshake & Monotonic Nonce Replay Prevention
"""

import struct
import hmac
import hashlib
import secrets
import threading
import time
from typing import Tuple, Optional

# Try hardware-accelerated OpenSSL bindings from cryptography library;
# provide mathematically exact pure-Python fallbacks for RFC 7748 and RFC 8439
# so the agent runs anywhere with zero required native DLL dependencies.
try:
    from cryptography.hazmat.primitives.asymmetric import x25519
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
    HAS_CRYPTOGRAPHY_LIB = True
except ImportError:
    HAS_CRYPTOGRAPHY_LIB = False


# =====================================================================
# CONSTANTS & PROTOCOL STRUCTS
# =====================================================================
KEY_SIZE = 32          # 256-bit symmetric key
NONCE_SIZE = 12        # 96-bit ChaCha20-Poly1305 nonce
TAG_SIZE = 16          # 128-bit Poly1305 authentication tag
SALT_SIZE = 16         # 128-bit HKDF salt
HANDSHAKE_MAGIC = b'CST_ECDH_V1'
INFO_STRING = b"cst-autonomous-lan-session-key-v1"


# =====================================================================
# RFC 7748 PURE PYTHON CURVE25519 / X25519 ARITHMETIC FALLBACK
# =====================================================================
_P = 2**255 - 19
_A24 = 121665

def _clamp_scalar(k_bytes: bytes) -> int:
    a = bytearray(k_bytes)
    a[0] &= 248
    a[31] &= 127
    a[31] |= 64
    return int.from_bytes(a, 'little')

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


class PurePythonX25519:
    @staticmethod
    def generate_private_key() -> bytes:
        return secrets.token_bytes(32)

    @staticmethod
    def public_key_from_private(private_key: bytes) -> bytes:
        if not isinstance(private_key, (bytes, bytearray)) or len(private_key) != KEY_SIZE:
            raise ValueError("X25519 private key must be exactly 32 bytes.")
        k = _clamp_scalar(bytes(private_key))
        pub_int = _x25519_eval(k, 9)
        return pub_int.to_bytes(32, 'little')

    @staticmethod
    def compute_shared_secret(private_key: bytes, peer_public_key: bytes) -> bytes:
        if not isinstance(private_key, (bytes, bytearray)) or len(private_key) != KEY_SIZE:
            raise ValueError("X25519 private key must be exactly 32 bytes.")
        if not isinstance(peer_public_key, (bytes, bytearray)) or len(peer_public_key) != KEY_SIZE:
            raise ValueError("X25519 peer public key must be exactly 32 bytes.")
        k = _clamp_scalar(bytes(private_key))
        u = int.from_bytes(bytes(peer_public_key), 'little')
        shared_int = _x25519_eval(k, u)
        return shared_int.to_bytes(32, 'little')


class FastX25519:
    """
    Hardware-accelerated X25519 ECDH engine utilizing OpenSSL C-assembly when
    cryptography is installed, falling back cleanly to PurePythonX25519.
    """
    @staticmethod
    def generate_private_key() -> bytes:
        if HAS_CRYPTOGRAPHY_LIB:
            try:
                return x25519.X25519PrivateKey.generate().private_bytes_raw()
            except (AttributeError, ImportError):
                pass
        return PurePythonX25519.generate_private_key()

    @staticmethod
    def public_key_from_private(private_key: bytes) -> bytes:
        if not isinstance(private_key, (bytes, bytearray)) or len(private_key) != KEY_SIZE:
            raise ValueError("X25519 private key must be exactly 32 bytes.")
        if HAS_CRYPTOGRAPHY_LIB:
            try:
                return x25519.X25519PrivateKey.from_private_bytes(bytes(private_key)).public_key().public_bytes_raw()
            except (AttributeError, ImportError):
                pass
        return PurePythonX25519.public_key_from_private(bytes(private_key))

    @staticmethod
    def compute_shared_secret(private_key: bytes, peer_public_key: bytes) -> bytes:
        if not isinstance(private_key, (bytes, bytearray)) or len(private_key) != KEY_SIZE:
            raise ValueError("X25519 private key must be exactly 32 bytes.")
        if not isinstance(peer_public_key, (bytes, bytearray)) or len(peer_public_key) != KEY_SIZE:
            raise ValueError("X25519 peer public key must be exactly 32 bytes.")
        if HAS_CRYPTOGRAPHY_LIB:
            try:
                priv = x25519.X25519PrivateKey.from_private_bytes(bytes(private_key))
                pub = x25519.X25519PublicKey.from_public_bytes(bytes(peer_public_key))
                return priv.exchange(pub)
            except (AttributeError, ImportError):
                pass
        return PurePythonX25519.compute_shared_secret(bytes(private_key), bytes(peer_public_key))


# =====================================================================
# RFC 5869 HKDF-SHA256 (EXTRACT & EXPAND)
# =====================================================================
def hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    if not salt:
        salt = b'\x00' * 32
    return hmac.new(salt, ikm, hashlib.sha256).digest()

def hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    hash_len = 32
    n = (length + hash_len - 1) // hash_len
    okm = bytearray()
    t = b""
    for i in range(1, n + 1):
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm.extend(t)
    return bytes(okm[:length])

def derive_session_key(shared_secret: bytes, salt: bytes, info: bytes = INFO_STRING) -> bytes:
    if HAS_CRYPTOGRAPHY_LIB:
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=salt,
            info=info,
        )
        return hkdf.derive(shared_secret)
    else:
        prk = hkdf_extract(salt, shared_secret)
        return hkdf_expand(prk, info, KEY_SIZE)


# =====================================================================
# RFC 8439 CHACHA20-POLY1305 PURE PYTHON FALLBACK
# =====================================================================
_STRUCT_8I = struct.Struct('<8I')
_STRUCT_3I = struct.Struct('<3I')
_STRUCT_16I = struct.Struct('<16I')

def _rotl32(v: int, c: int) -> int:
    return ((v << c) & 0xFFFFFFFF) | (v >> (32 - c))

def _quarter_round(x: list, a: int, b: int, c: int, d: int):
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 16)
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 12)
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF; x[d] = _rotl32(x[d] ^ x[a], 8)
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF; x[b] = _rotl32(x[b] ^ x[c], 7)

def _chacha20_block(key: bytes, counter: int, nonce: bytes) -> bytes:
    s0, s1, s2, s3 = 0x61707865, 0x3320646e, 0x79622d32, 0x6b206574
    s4, s5, s6, s7, s8, s9, s10, s11 = _STRUCT_8I.unpack(key)
    s12 = counter & 0xFFFFFFFF
    s13, s14, s15 = _STRUCT_3I.unpack(nonce)

    x0, x1, x2, x3 = s0, s1, s2, s3
    x4, x5, x6, x7 = s4, s5, s6, s7
    x8, x9, x10, x11 = s8, s9, s10, s11
    x12, x13, x14, x15 = s12, s13, s14, s15

    for _ in range(10):
        # Column rounds
        x0 = (x0 + x4) & 0xFFFFFFFF; d = x12 ^ x0; x12 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x8 = (x8 + x12) & 0xFFFFFFFF; b = x4 ^ x8; x4 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x0 = (x0 + x4) & 0xFFFFFFFF; d = x12 ^ x0; x12 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x8 = (x8 + x12) & 0xFFFFFFFF; b = x4 ^ x8; x4 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        x1 = (x1 + x5) & 0xFFFFFFFF; d = x13 ^ x1; x13 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x9 = (x9 + x13) & 0xFFFFFFFF; b = x5 ^ x9; x5 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x1 = (x1 + x5) & 0xFFFFFFFF; d = x13 ^ x1; x13 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x9 = (x9 + x13) & 0xFFFFFFFF; b = x5 ^ x9; x5 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        x2 = (x2 + x6) & 0xFFFFFFFF; d = x14 ^ x2; x14 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x10 = (x10 + x14) & 0xFFFFFFFF; b = x6 ^ x10; x6 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x2 = (x2 + x6) & 0xFFFFFFFF; d = x14 ^ x2; x14 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x10 = (x10 + x14) & 0xFFFFFFFF; b = x6 ^ x10; x6 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        x3 = (x3 + x7) & 0xFFFFFFFF; d = x15 ^ x3; x15 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x11 = (x11 + x15) & 0xFFFFFFFF; b = x7 ^ x11; x7 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x3 = (x3 + x7) & 0xFFFFFFFF; d = x15 ^ x3; x15 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x11 = (x11 + x15) & 0xFFFFFFFF; b = x7 ^ x11; x7 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        # Diagonal rounds
        x0 = (x0 + x5) & 0xFFFFFFFF; d = x15 ^ x0; x15 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x10 = (x10 + x15) & 0xFFFFFFFF; b = x5 ^ x10; x5 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x0 = (x0 + x5) & 0xFFFFFFFF; d = x15 ^ x0; x15 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x10 = (x10 + x15) & 0xFFFFFFFF; b = x5 ^ x10; x5 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        x1 = (x1 + x6) & 0xFFFFFFFF; d = x12 ^ x1; x12 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x11 = (x11 + x12) & 0xFFFFFFFF; b = x6 ^ x11; x6 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x1 = (x1 + x6) & 0xFFFFFFFF; d = x12 ^ x1; x12 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x11 = (x11 + x12) & 0xFFFFFFFF; b = x6 ^ x11; x6 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        x2 = (x2 + x7) & 0xFFFFFFFF; d = x13 ^ x2; x13 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x8 = (x8 + x13) & 0xFFFFFFFF; b = x7 ^ x8; x7 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x2 = (x2 + x7) & 0xFFFFFFFF; d = x13 ^ x2; x13 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x8 = (x8 + x13) & 0xFFFFFFFF; b = x7 ^ x8; x7 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

        x3 = (x3 + x4) & 0xFFFFFFFF; d = x14 ^ x3; x14 = ((d << 16) & 0xFFFFFFFF) | (d >> 16)
        x9 = (x9 + x14) & 0xFFFFFFFF; b = x4 ^ x9; x4 = ((b << 12) & 0xFFFFFFFF) | (b >> 20)
        x3 = (x3 + x4) & 0xFFFFFFFF; d = x14 ^ x3; x14 = ((d << 8) & 0xFFFFFFFF) | (d >> 24)
        x9 = (x9 + x14) & 0xFFFFFFFF; b = x4 ^ x9; x4 = ((b << 7) & 0xFFFFFFFF) | (b >> 25)

    return _STRUCT_16I.pack(
        (x0 + s0) & 0xFFFFFFFF, (x1 + s1) & 0xFFFFFFFF, (x2 + s2) & 0xFFFFFFFF, (x3 + s3) & 0xFFFFFFFF,
        (x4 + s4) & 0xFFFFFFFF, (x5 + s5) & 0xFFFFFFFF, (x6 + s6) & 0xFFFFFFFF, (x7 + s7) & 0xFFFFFFFF,
        (x8 + s8) & 0xFFFFFFFF, (x9 + s9) & 0xFFFFFFFF, (x10 + s10) & 0xFFFFFFFF, (x11 + s11) & 0xFFFFFFFF,
        (x12 + s12) & 0xFFFFFFFF, (x13 + s13) & 0xFFFFFFFF, (x14 + s14) & 0xFFFFFFFF, (x15 + s15) & 0xFFFFFFFF,
    )

def _poly1305_clamp(r_bytes: bytes) -> int:
    r = bytearray(r_bytes)
    r[3] &= 15; r[7] &= 15; r[11] &= 15; r[15] &= 15
    r[4] &= 252; r[8] &= 252; r[12] &= 252
    return int.from_bytes(r, 'little')

def _poly1305_mac(msg: bytes, key: bytes) -> bytes:
    r = _poly1305_clamp(key[:16])
    s = int.from_bytes(key[16:], 'little')
    p = (1 << 130) - 5
    accumulator = 0

    for i in range(0, len(msg), 16):
        chunk = msg[i:i + 16]
        n = int.from_bytes(chunk + b'\x01', 'little')
        accumulator = ((accumulator + n) * r) % p

    tag_int = (accumulator + s) % (1 << 128)
    return tag_int.to_bytes(16, 'little')

def _chacha20_crypt(key: bytes, nonce: bytes, data: bytes, initial_counter: int = 1) -> bytes:
    if not data:
        return b""
    blocks = []
    counter = initial_counter
    bytes_left = len(data)
    while bytes_left > 0:
        blk = _chacha20_block(key, counter, nonce)
        blocks.append(blk[:bytes_left])
        bytes_left -= len(blk)
        counter += 1
    stream = b"".join(blocks)
    n = len(data)
    return (int.from_bytes(data, "little") ^ int.from_bytes(stream, "little")).to_bytes(n, "little")

def pure_chacha20_poly1305_encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    otk = _chacha20_block(key, 0, nonce)[:32]
    ciphertext = _chacha20_crypt(key, nonce, plaintext, initial_counter=1)

    pad1 = b'\x00' * ((16 - (len(aad) % 16)) % 16)
    pad2 = b'\x00' * ((16 - (len(ciphertext) % 16)) % 16)
    mac_data = aad + pad1 + ciphertext + pad2 + struct.pack('<QQ', len(aad), len(ciphertext))
    tag = _poly1305_mac(mac_data, otk)
    return ciphertext + tag

def pure_chacha20_poly1305_decrypt(key: bytes, nonce: bytes, ciphertext_and_tag: bytes, aad: bytes = b"") -> bytes:
    if len(ciphertext_and_tag) < TAG_SIZE:
        raise ValueError("Ciphertext too short for Poly1305 tag")
    ciphertext = ciphertext_and_tag[:-TAG_SIZE]
    received_tag = ciphertext_and_tag[-TAG_SIZE:]

    otk = _chacha20_block(key, 0, nonce)[:32]
    pad1 = b'\x00' * ((16 - (len(aad) % 16)) % 16)
    pad2 = b'\x00' * ((16 - (len(ciphertext) % 16)) % 16)
    mac_data = aad + pad1 + ciphertext + pad2 + struct.pack('<QQ', len(aad), len(ciphertext))
    expected_tag = _poly1305_mac(mac_data, otk)

    if not hmac.compare_digest(received_tag, expected_tag):
        raise ValueError("Poly1305 MAC tag mismatch! Payload corrupted or forged.")

    return _chacha20_crypt(key, nonce, ciphertext, initial_counter=1)


# =====================================================================
# UNIFIED AEAD WRAPPER
# =====================================================================
class AuthenticatedCipher:
    def __init__(self, session_key: bytes):
        if len(session_key) != KEY_SIZE:
            raise ValueError(f"Session key must be {KEY_SIZE} bytes")
        self.session_key = session_key
        if HAS_CRYPTOGRAPHY_LIB:
            self._cipher = ChaCha20Poly1305(session_key)
        else:
            self._cipher = None

    def encrypt(self, nonce: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
        if len(nonce) != NONCE_SIZE:
            raise ValueError(f"Nonce must be {NONCE_SIZE} bytes")
        if self._cipher:
            return self._cipher.encrypt(nonce, plaintext, aad)
        return pure_chacha20_poly1305_encrypt(self.session_key, nonce, plaintext, aad)

    def decrypt(self, nonce: bytes, ciphertext_with_tag: bytes, aad: bytes = b"") -> bytes:
        if len(nonce) != NONCE_SIZE:
            raise ValueError(f"Nonce must be {NONCE_SIZE} bytes")
        if self._cipher:
            try:
                return self._cipher.decrypt(nonce, ciphertext_with_tag, aad)
            except Exception as e:
                raise ValueError(f"Poly1305 MAC tag mismatch: {e}") from e
        return pure_chacha20_poly1305_decrypt(self.session_key, nonce, ciphertext_with_tag, aad)


# =====================================================================
# EPHEMERAL ZERO-TRUST SESSION HANDSHAKE MANAGER
# =====================================================================
class HostCryptoSession:
    """
    Manages the life-cycle of a single WebSocket client's encrypted session.
    Provides Perfect Forward Secrecy via ephemeral X25519 pairs generated per connection,
    directional TX/RX session key separation, and sender-tag + replay validation.
    """
    _HOST_SENDER_TAG = 0x484F5354  # 'HOST'
    _CLIENT_SENDER_TAGS = {0x4D4F424C, 0x434C494E}  # 'MOBL', 'CLIN'
    _HANDSHAKE_TTL_SEC = 120

    def __init__(self, psk_secret: bytes):
        if not psk_secret or len(psk_secret) == 0:
            raise ValueError("Pre-shared key (PSK) must not be empty.")
        self._lock = threading.RLock()
        self.psk: Optional[bytes] = psk_secret
        self.session_key: Optional[bytes] = None
        self.tx_key: Optional[bytes] = None
        self.rx_key: Optional[bytes] = None
        self.cipher: Optional[AuthenticatedCipher] = None
        self._tx_cipher: Optional[AuthenticatedCipher] = None
        self._rx_cipher: Optional[AuthenticatedCipher] = None
        self.is_established: bool = False
        self._closed: bool = False

        # Monotonic Nonce counters (prevents replay attacks)
        self._tx_nonce_counter = 0
        self._rx_last_nonce_counter = 0

        # Generate Host Ephemeral Curve25519 Key Pair
        if HAS_CRYPTOGRAPHY_LIB:
            self._private_key_obj = x25519.X25519PrivateKey.generate()
            self._public_bytes = self._private_key_obj.public_key().public_bytes_raw()
            self._private_bytes = None
        else:
            self._private_bytes = PurePythonX25519.generate_private_key()
            self._public_bytes = PurePythonX25519.public_key_from_private(self._private_bytes)
            self._private_key_obj = None

        self.salt = secrets.token_bytes(SALT_SIZE)
        self.handshake_timestamp = int(time.time())

    def create_handshake_challenge(self) -> bytes:
        """
        Creates Opcode 0x06 Challenge Payload:
        Format: [MAGIC (11 bytes)] + [Host X25519 Pubkey (32 bytes)] + [Salt (16 bytes)] + [Timestamp (8 bytes)]
        """
        with self._lock:
            if self._closed:
                raise RuntimeError("Cryptographic session is closed.")
            payload = bytearray()
            payload.extend(HANDSHAKE_MAGIC)
            payload.extend(self._public_bytes)
            payload.extend(self.salt)
            payload.extend(struct.pack('!Q', self.handshake_timestamp))
            return bytes(payload)

    def process_handshake_response(self, client_response_payload: bytes) -> bool:
        """
        Processes Client Handshake Response:
        Format: [Client X25519 Pubkey (32 bytes)] + [HMAC-SHA256 Auth Tag (32 bytes)]
        """
        with self._lock:
            if self._closed or self.is_established or not self.psk:
                return False
            if abs(int(time.time()) - self.handshake_timestamp) > self._HANDSHAKE_TTL_SEC:
                return False
            if len(client_response_payload) != 64:
                return False

            client_pubkey = client_response_payload[:32]
            client_auth_tag = client_response_payload[32:64]

            # Verify client proved knowledge of Pre-Shared Key (PSK) bound to timestamp
            ts_bytes = struct.pack('!Q', self.handshake_timestamp)
            expected_tag = hmac.new(
                self.psk,
                HANDSHAKE_MAGIC + self._public_bytes + client_pubkey + self.salt + ts_bytes,
                hashlib.sha256
            ).digest()

            if not hmac.compare_digest(client_auth_tag, expected_tag):
                return False

            # Compute ECDH Shared Secret
            try:
                if HAS_CRYPTOGRAPHY_LIB and self._private_key_obj:
                    peer_pub_obj = x25519.X25519PublicKey.from_public_bytes(client_pubkey)
                    shared_secret = self._private_key_obj.exchange(peer_pub_obj)
                elif self._private_bytes:
                    shared_secret = PurePythonX25519.compute_shared_secret(self._private_bytes, client_pubkey)
                else:
                    return False
            except Exception:
                return False

            # RFC 7748 low-order point check: reject all-zero shared secret
            if hmac.compare_digest(shared_secret, b"\x00" * 32):
                return False

            # Derive directional TX/RX keys so host packets cannot be reflected back as client packets
            self.session_key = derive_session_key(shared_secret, self.salt, INFO_STRING)
            self.tx_key = derive_session_key(shared_secret, self.salt, INFO_STRING + b"-host-tx")
            self.rx_key = derive_session_key(shared_secret, self.salt, INFO_STRING + b"-client-tx")
            self.cipher = AuthenticatedCipher(self.session_key)
            self._tx_cipher = AuthenticatedCipher(self.tx_key)
            self._rx_cipher = AuthenticatedCipher(self.rx_key)
            self._private_key_obj = None
            self._private_bytes = None
            self.is_established = True
            return True

    def generate_tx_nonce(self) -> bytes:
        """
        Generates a strictly monotonic 96-bit (12-byte) nonce:
        [8-byte big-endian counter >= 1] + [4-byte fixed host identifier]
        """
        with self._lock:
            self._tx_nonce_counter += 1
            return struct.pack('!QI', self._tx_nonce_counter, self._HOST_SENDER_TAG)

    def encrypt_frame(self, header_aad: bytes, plaintext: bytes) -> Tuple[bytes, bytes]:
        """
        Encrypts payload using ChaCha20-Poly1305 with the host-TX directional key.
        Returns: (12-byte nonce, ciphertext + 16-byte tag)
        """
        with self._lock:
            if self._closed or not self.is_established or not self._tx_cipher:
                raise RuntimeError("Cryptographic session not established or closed")
            nonce = self.generate_tx_nonce()
            ciphertext_tag = self._tx_cipher.encrypt(nonce, plaintext, aad=header_aad)
            return nonce, ciphertext_tag

    def decrypt_frame(self, header_aad: bytes, nonce: bytes, ciphertext_tag: bytes) -> bytes:
        """
        Decrypts payload using the client-TX directional key, validating sender tag
        and monotonic counter before decryption.
        """
        with self._lock:
            if self._closed or not self.is_established or not self._rx_cipher:
                raise RuntimeError("Cryptographic session not established or closed")
            if len(nonce) != NONCE_SIZE:
                raise ValueError(f"Invalid nonce length: {len(nonce)}")

            rx_counter, sender_tag = struct.unpack('!QI', nonce)
            if sender_tag == self._HOST_SENDER_TAG or sender_tag not in self._CLIENT_SENDER_TAGS:
                raise ValueError("Invalid sender identifier in nonce (possible packet reflection attack)")
            if rx_counter <= 0 or rx_counter <= self._rx_last_nonce_counter:
                raise ValueError(f"Replay attack detected! Received counter {rx_counter} <= {self._rx_last_nonce_counter}")

            # Decrypt & verify MAC before committing counter state
            plaintext = self._rx_cipher.decrypt(nonce, ciphertext_tag, aad=header_aad)
            self._rx_last_nonce_counter = rx_counter
            return plaintext

    def close(self) -> None:
        """Zeroes and clears all session state."""
        with self._lock:
            self._closed = True
            self.is_established = False
            self.psk = None
            self.session_key = None
            self.tx_key = None
            self.rx_key = None
            self.cipher = None
            self._tx_cipher = None
            self._rx_cipher = None
            self._private_key_obj = None
            self._private_bytes = None

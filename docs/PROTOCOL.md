# Binary Wire Protocol & Cryptographic Specification

AI NetController uses a framed binary WebSocket protocol designed for low-overhead LAN telemetry, adaptive JPEG screen streaming, input forwarding, chunked file transfer, and shell supervision across the Python Host Agent (`agent/`), Flutter mobile client (`apps/mobile/`), and Web control console (`apps/web/`).

## 1. Frame Format

Every WebSocket binary frame starts with a fixed **12-byte big-endian header** (`!2sBBII` in Python `struct`):

| Offset | Size (Bytes) | Field | Encoding | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0` | `2` | `magic` | `0xC5 0x71` | Protocol frame identifier |
| `2` | `1` | `opcode` | `uint8` | Message type (`0x01`–`0xEE`) |
| `3` | `1` | `flags` | `uint8` bitmask | Encoding and fragmentation flags |
| `4` | `4` | `seq` | `uint32` BE | Monotonic sequence counter (`>= 1` post-auth) |
| `8` | `4` | `length` | `uint32` BE | Payload byte length (`<= 10 MiB`) |
| `12` | `length` | `payload` | `bytes` | Plaintext or AEAD-protected body |

Frames whose magic bytes do not equal `0xC5 0x71`, whose `length > 10 * 1024 * 1024`, or whose WebSocket frame length differs from `12 + length` are rejected immediately.

### Flags Bitmask

| Bit / Value | Constant | Meaning |
| :--- | :--- | :--- |
| `0x00` | `NONE` | Uncompressed, unencrypted, single-frame payload |
| `0x01` | `COMPRESSED` / handshake flag | Compressed payload (post-auth) or handshake phase flag on `OP_AUTH` |
| `0x02` | `ENCRYPTED` | Payload encrypted and authenticated with ChaCha20-Poly1305 AEAD |
| `0x04` | `IS_FRAGMENTED` | Sub-MTU / 64 KiB fragment chunk |
| `0x08` | `IS_LAST_FRAGMENT` | Final fragment of a multi-part message |

## 2. Canonical Opcode Registry

| Opcode | Name | Direction | Purpose |
| :--- | :--- | :--- | :--- |
| `0x01` | `OP_PING` | Bidirectional | Heartbeat keepalive (`PONG`) |
| `0x02` | `OP_TELEMETRY` | Agent -> Client | JSON host telemetry (CPU, RAM, disk, OS, security flags, active display) |
| `0x03` | `OP_FRAME` | Agent -> Client | JPEG desktop capture frame |
| `0x04` | `OP_SHELL` | Bidirectional | Remote command dispatch and stdout/stderr/exit status |
| `0x05` | `OP_HITL` | Bidirectional | Human-in-the-Loop approval challenges and HMAC-signed operator responses |
| `0x06` | `OP_AUTH` | Bidirectional | Nonce authentication and `INIT_ECDH_VAULT` / `INIT_ECDH_VAULT_M` setup |
| `0x07` | `OP_CLIP` | Bidirectional | Clipboard synchronization (policy-gated on the host) |
| `0x08` | `OP_INPUT` | Client -> Agent | 6-byte binary input packet (`!BhhB`) or structured pointer/key event |
| `0x09` | `OP_AUDIO` | Client -> Agent | Media session playback and volume controls |
| `0x0A` | `OP_VIEWPORT_RESIZE` | Client -> Agent | Target display stream dimensions (`width`, `height`) |
| `0x0B` | `OP_LLM_STREAM` | Bidirectional | Local Ollama / AI diagnostic token stream |
| `0x0C` | `OP_FILE_TRANSFER` | Bidirectional | 64 KiB chunked file upload with rolling SHA-256 parity and ACKs |
| `0x0D` | `OP_DISPLAY_ENUM` | Bidirectional | Multi-monitor enumeration and active display selection |
| `0xED` | `OP_FRAME_SYNC` | Client -> Agent | Explicit keyframe / stream resynchronization request |
| `0xEE` | `OP_ERR` | Agent -> Client | Structured error notification |

### 6-Byte Binary Input (`OP_INPUT`)

Pointer deltas and key actions can be coalesced at 16 ms intervals into a compact `!BhhB` struct (`event_type`, `dx`, `dy`, `button_or_key`) to minimize allocation pressure during active remote-desktop interaction.

## 3. Authentication & Encrypted Transport

1. **Pre-Authentication Firewall**: Before `OP_AUTH` succeeds, the host drops or closes (`1008`) any privileged opcode (`OP_SHELL`, `OP_INPUT`, `OP_CLIP`, `OP_FILE_TRANSFER`, `OP_AUDIO`, `OP_DISPLAY_ENUM`). Only `OP_AUTH` and `OP_PING` are processed unauthenticated.
2. **Nonce Challenge-Response**: Upon WebSocket open, the host issues `OP_AUTH` (`seq=0`, `flags=0x00`) with a 16-byte CSPRNG nonce valid for `10s`. Clients compute `HMAC-SHA256(utf8(secret), nonce)` and receive `OK_AUTHENTICATED` (`16` ASCII bytes; clients distinguish handshake ACK from nonce frames before vault establishment).
3. **Encrypted PIN Pairing (`PAIR_INIT` / `PAIR_FINISH`)**: When pairing with a 6-digit PIN (`PIN_TTL_SECONDS = 900`), mobile clients negotiate an ephemeral X25519 shared secret and transmit PIN verification inside a ChaCha20-Poly1305 encrypted envelope to obtain the host pairing token and optional TLS certificate SHA-256 fingerprint.
4. **Mutual Authenticated Vault (`CST_ECDH_V2`)**:
   - Client initiates via `OP_AUTH` carrying `INIT_ECDH_VAULT_M:` + 16-byte client challenge (`34` bytes).
   - Host replies with a **91-byte** signed challenge (`[protocol_magic | 32B host_pub | 16B salt | 8B timestamp | HMAC proof]`), enforcing clock skew and RFC 7748 low-order all-zero shared secret rejection.
   - Both sides derive twin directional 256-bit keys via HKDF-SHA256 using distinct `info` contexts (`cst-client-tx` and `cst-host-tx`) so reflected packets cannot validate on the sender side.
   - Encrypted frames set `flags = 0x02` (`ENCRYPTED`), bind the **12-byte wire header as AEAD AAD**, use a monotonic counter (`seq >= 1`), and update the RFC 6479 **128-bit sliding-window replay guard** only after Poly1305 tag verification passes.
5. **Optional `wss://` TLS Pinning**: When enabled, [`agent/tls_manager.py`](../agent/tls_manager.py) generates a SAN-bound ECDSA P-256 certificate and exposes its SHA-256 digest for client pinning.

## 4. Human-in-the-Loop (HITL) Safety Gate

Commands submitted on `OP_SHELL` are parsed by [`agent/command_ast_firewall.py`](../agent/command_ast_firewall.py):

- **Blocked**: Destructive wipe/credential patterns are unconditionally rejected without an override prompt.
- **Requires Confirmation (`OP_HITL`)**: Elevated or state-mutating operations generate an unpredictable `approval_id` and `challenge_nonce`. Standard remote profiles require an explicit `HMAC-SHA256` signed approval bound to the originating WebSocket session; `strict` host policy accepts local host-UI confirmation only.

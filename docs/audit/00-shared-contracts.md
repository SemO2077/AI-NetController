# Cross-Stack Shared Contracts & Source of Truth

This document is the **single authoritative contract** for every binary frame, opcode, handshake, cryptographic primitive, secret-management rule, and Human-in-the-Loop (HITL) safety invariant shared across:
- **Python Host Agent**: [`agent/agent.py`](file:///C:/Users/Lenovo/.gemini/antigravity/worktrees/bold-hertz/refactor_project_structure/agent/agent.py), `agent/agent_daemon.py`, `agent/crypto_handshake.py`, `agent/crypto_vault.py`, `agent/network_fuzzer_shield.py`, `agent/command_ast_firewall.py`, `agent/host_file_writer.py`, `agent/multi_monitor_streamer.py`, `agent/daemon_config.py`
- **Web Console & Node Server**: `apps/web/src/workers/networkWorker.ts`, `apps/web/src/hooks/useWorkerEngine.ts`, `apps/web/src/utils/binaryFramer.ts`, `apps/web/src/services/securityService.ts`, `apps/web/server.ts`
- **Mobile Flutter / Android Native**: `apps/mobile/lib/protocol/binary_protocol.dart` (at base `72c84a4`: `apps/mobile/lib/binary_protocol.dart`), `crypto_channel.dart`, `crypto_engine.dart`, `network_framer.dart`, `fragmentation_engine.dart`, `viewport_stream_widget.dart`, `scripts/build_android_app.py` (embedded `MainActivity.java`)

> **Rule**: No branch (`chore/project-structure`, `fix/agent-and-crypto`, or `fix/web-core-and-ui`) may deviate from this specification. When Python, TypeScript, and Dart disagree, **update the code to match this document**, or propose an explicit revision here first.

---

## 1. Binary Wire Protocol Framing

### 1.1 Canonical 12-Byte Packet Header (`!BBBBII`)

Every binary WebSocket frame MUST start with a fixed **12-byte big-endian (network byte order) header**:

| Offset | Size | Field | Type | Value / Semantics |
|---|---|---|---|---|
| `0` | 1 B | `magic0` | `uint8` | `0xC5` |
| `1` | 1 B | `magic1` | `uint8` | `0x71` |
| `2` | 1 B | `opcode` | `uint8` | Canonical opcode (`§2`) |
| `3` | 1 B | `flags` | `uint8` | Bitmask (`0x01` = Auth/Ack/Delta metadata, `0x02` = ChaCha20-Poly1305 AEAD encrypted body, `0x04` = Fragmented) |
| `4..7` | 4 B | `seq` | `uint32` BE | Packet sequence number (`0` allowed **only** for `OP_AUTH` challenge & initial `OP_PING`; all post-auth frames MUST be monotonic `>= 1`) |
| `8..11` | 4 B | `length` | `uint32` BE | Exact byte length of payload immediately following byte `11` (`0 .. MAX_PAYLOAD_SIZE`) |

- **Constants**:
  - `HEADER_SIZE = 12`
  - `MAX_PAYLOAD_SIZE = 10 * 1024 * 1024` (10 MiB; WebSocket messages exceeding `12 + MAX_PAYLOAD_SIZE` MUST be rejected before allocation).
- **Deprecations to Eliminate**:
  - `agent/agent_daemon.py` previously emitted `0x55 0xAA` over raw TCP with `opcode=0x01` (`OP_PING`) for video frames. Unify on `0xC5 0x71` and `OP_FRAME (0x03)`.
  - `apps/mobile/lib/protocol/network_framer.dart` previously declared `kSyncByte0 = 0x55`, `kSyncByte1 = 0xAA`. Must use `0xC5 0x71` strictly.

### 1.2 Single-Frame Exact-Length & Boundary Validation Rule

Because WebSocket binary messages deliver discrete framed messages (not unframed TCP byte streams):

1. Every parser receiving a WebSocket binary message (`binary_protocol.dart` `BinaryProtocol.parse`, `viewport_stream_widget.dart` `StreamBinaryPacket.parse`, `networkWorker.ts` `parseBinaryFrame`, `agent.py` `unpack_packet`) MUST validate:
   - `raw.length >= 12`
   - `raw[0] == 0xC5 && raw[1] == 0x71` (checked **before** reading `opcode` or mutating state — fixes `agent/network_fuzzer_shield.py` which previously inspected `raw[2]` before magic validation)
   - `length <= MAX_PAYLOAD_SIZE`
   - **`raw.length == 12 + length` (exact equality)** — NOT `< 12 + length`. Trailing bytes outside the declared payload MUST cause packet rejection (`return null` / throw / send `OP_ERR`).
2. `apps/web/src/utils/binaryFramer.ts` MUST NOT return views over shared module-level buffers (`SCRATCH_HEADER`, `POOL_CONTROL_BUFFER`) across async send queues; either copy into the outgoing `Uint8Array` or allocate per packet so back-to-back sends cannot overwrite each other.
3. For TCP stream transports that legitimately coalesce multiple frames, the stream framer MUST advance read offsets explicitly by `12 + length` and preserve remainders rather than silently discarding trailing bytes.

---

## 2. Canonical Opcode Registry (Collision Resolution)

This table resolves the historical `0x0B` (`OP_LLM_STREAM` vs `OP_DISPLAY_ENUM`), `0x02` (`OP_TELEMETRY` vs legacy `OP_PONG`), and `0xEE` (`OP_ERR` vs `OP_FRAME_SYNC`) collisions across Python, TypeScript, and Dart:

| Hex | Dec | Canonical Name | Direction | Payload & Notes |
|---|---|---|---|---|
| `0x00` | `0` | `OP_UNKNOWN` | Reserved | Invalid / uninitialized sentinel. Never use `payload.opcode \|\| 0x04` coercion. |
| `0x01` | `1` | `OP_PING` | Bidirectional | Keep-alive PING & PONG echo (`seq` echoed back for RTT measurement). **Do NOT alias `0x02` as `OP_PONG`.** |
| `0x02` | `2` | `OP_TELEMETRY` | Host -> Client | UTF-8 JSON host metrics (CPU, RAM, OS, hostname, screen width/height, FPS, battery/charging). |
| `0x03` | `3` | `OP_FRAME` | Host -> Client | Compressed screen frame (JPEG / delta frame; must validate SOI `0xFFD8` & EOI `0xFFD9`). |
| `0x04` | `4` | `OP_SHELL` | Client -> Host | Command execution request (UTF-8 JSON or command payload). TS alias `OP_COMMAND` maps to `0x04`. |
| `0x05` | `5` | `OP_HITL` | Bidirectional | HITL approval challenge (`Host -> Client`) and signed response (`Client -> Host`). Correlated via `approval_id`, not `seq`. |
| `0x06` | `6` | `OP_AUTH` | Bidirectional | Pre-auth & ECDH/HMAC handshake frames (allowed before `authenticated = true`). |
| `0x07` | `7` | `OP_CLIP` | Bidirectional | Clipboard synchronization (gated by `clipboard_sync_allowed` & `view_only_mode`). |
| `0x08` | `8` | `OP_INPUT` | Client -> Host | Remote mouse/keyboard/hotkey input (UTF-8 JSON envelope or compact binary). |
| `0x09` | `9` | `OP_AUDIO` | Bidirectional | Audio/media control (`!BB` or JSON). **No** viewport resize overload heuristic (`len == 8` / `"width"`). |
| `0x0A` | `10` | `OP_VIEWPORT_RESIZE` | Client -> Host | Viewport negotiation: either UTF-8 JSON (`payload.lstrip().startswith(b'{')` **checked first!**) or exact `8`-byte struct (`!II` `width, height`). |
| `0x0B` | `11` | `OP_LLM_STREAM` | Bidirectional | Local Ollama / AI token streaming **only**. (Previously collided with `DISPLAY_ENUM`). |
| `0x0C` | `12` | `OP_FILE_TRANSFER` | Bidirectional | Chunked verified file transfer (`CMD_INIT`/`CHUNK`/`FINISH`/`ABORT` + ACK). |
| `0x0D` | `13` | `OP_DISPLAY_ENUM` | Bidirectional | **Canonical assignment** for Multi-Monitor Display Enumeration & active display switching (moves off `0x0B`). |
| `0xED` | `237` | `OP_FRAME_SYNC` | Client <-> Host | **Canonical assignment** for Keyframe / Stream Resynchronization Request (moves off `0xEE`). |
| `0xEE` | `238` | `OP_ERR` | Host -> Client | Structured error response frame (UTF-8 JSON `{ "error": ..., "code": ... }`). **Never dropped by `NetworkFuzzerShield`.** |

> **Contract Fixes Required**:
> - `agent/multi_monitor_streamer.py` (`0x0B` -> `0x0D`) and `agent/tests/test_e2e_loopback.py` (`0x0B` -> `0x0D`).
> - `agent/network_fuzzer_shield.py` (`OP_FRAME_SYNC` `0xEE` -> `0xED`; `OP_ERR = 0xEE` pass-through).
> - `apps/mobile/lib/protocol/binary_protocol.dart` & `viewport_stream_widget.dart` (`displayEnum = 0x0D`, `frameSync = 0xED`). *(Already updated in `backup/github-pushed-snapshot`, still needed on `chore/audit-setup`.)*
> - `apps/web/src/utils/binaryFramer.ts` (remove `OP_PONG = 0x02` alias; use `OP_DISPLAY_ENUM = 0x0D`, `OP_FRAME_SYNC = 0xED`, `OP_ERR = 0xEE`) and `apps/web/src/data/codeSnippets.ts` (remove stale `OP_ERR=8, OP_VIEWPORT_RESIZE=9, OP_LLM_STREAM=10`).
> - `agent/agent.py` `_process_viewport_resize` MUST check `if payload.lstrip().startswith(b'{'):` **before** `elif len(payload) == 8:` so JSON `{width, height}` payloads are not unpacked as `!II` integers (`3840x2160`), and `_process_audio_control` (`0x09`) MUST stop hijacking `len == 8` / `"width"` payloads.

---

## 3. Authentication, Transport & End-to-End Crypto Handshake

### 3.1 WebSocket Pre-Auth Firewall & Origin Rules

1. **Handshake Origin Protection (CSWSH Prevention)**:
   - Both `websockets.serve` and stdlib fallback adapter in `agent/agent.py` MUST validate the HTTP `Origin` header (`_is_origin_allowed`). Reject browser origins outside localhost/loopback or explicitly allowlisted origins.
2. **Pre-Auth Opcode Gate**:
   - Before authentication completes, `agent.py` MUST ONLY accept `OP_AUTH (0x06)`, `OP_PING (0x01)`, and JSON `PAIR`/`AUTHENTICATE` envelopes.
   - Any other opcode before auth MUST be rejected with `OP_ERR` and `ws.close(1008)`.
   - On failed authentication inside `handle_connection`, the loop MUST **`break`** immediately after `ws.close(1008)` (not `continue`).
3. **Auth State & Bug Invariants**:
   - **Never raise `UnboundLocalError` on failed auth (`agent/agent.py` `_process_auth`)**: resolve `client_ip` and `resolved_client_id` **unconditionally before** `if is_valid_hmac:` so `_record_auth_failure()` executes on every invalid attempt.
   - **Enforce headless security policies**: IP geofencing (`subnet_geofence_only`), blacklist checks, `is_paused`, and auth failure rate-limiting / auto-ban MUST run inside `HostAgentDaemon` directly even when `gui_state is None`.
   - **Client Fail-Closed Auth (`viewport_stream_widget.dart` & `networkWorker.ts`)**:
     - Dart `ViewportStreamWidget` MUST ONLY accept exact server confirmation tokens (`statusStr == 'AUTH_OK' || statusStr == 'OK_AUTHENTICATED'`), MUST **NEVER** use `.contains('AUTH')` or `.contains('OK')`, and MUST ignore/reject `OP_FRAME` if `_isConnected` / auth handshake has not completed!
     - TS `networkWorker.ts` MUST NOT post `{ type: 'STATUS', status: 'connected' }` or flush `outboundQueue` in `ws.onopen`; wait until `OK_AUTHENTICATED` / `AUTHENTICATED` arrives.
     - Neither TS nor Dart may attempt challenge-response auth with an empty `sharedSecret` (fail closed with `auth_required`).

### 3.2 Two-Layer Handshake & AEAD Wire Contract

#### Path 1: Challenge-Response HMAC-SHA256 (`OP_AUTH = 0x06`, Web & Basic WS)
1. Server sends `OP_AUTH` (`seq=0`, `flags=0x00`) with a **16-byte CSPRNG nonce** (`os.urandom(16)`). Client must respond within `MAX_NONCE_AGE_SECONDS` (30s).
2. Client computes `HMAC-SHA256(key = utf8_bytes(secret), msg = 16B_nonce)` and sends 32-byte digest in `OP_AUTH` (`seq=0`). No raw secret/token/PIN crosses the wire on JSON `AUTHENTICATE` when nonce HMAC is available.
3. Server verifies via `hmac.compare_digest` over current active credential(s) only, deletes single-use nonce, marks `ws` authenticated, and sends `OP_AUTH` `flags=0x01` `b"OK_AUTHENTICATED"`.

#### Path 2: End-to-End X25519 + HKDF-SHA256 + ChaCha20-Poly1305 AEAD (`HostCryptoVault` <-> `CryptoEngine` / `CryptoChannel`)
1. **Key Exchange & Key Derivation**:
   - X25519 scalar multiplication MUST clamp private keys AND mask bit 255 of peer `u`-coordinates (`u & ((1 << 255) - 1)`) per RFC 7748 (`crypto_engine.dart` & `crypto_channel.dart`).
   - **Mandatory RFC 7748 Low-Order Check**: All-zero shared secrets (`all(b == 0 for b in shared_secret)`) MUST be rejected on every side (`crypto_handshake.py`, `crypto_vault.py`, `crypto_channel.dart`, `crypto_engine.dart`).
   - **PSK Encoding**: Pre-shared keys MUST be encoded as **UTF-8** everywhere (`utf8.encode(psk)` in Dart, `.encode('utf-8')` in Python). Never use UTF-16 `codeUnits`.
   - **HMAC Transcript Authentication**: Challenge `[MAGIC | 32B HOST_PUB | 16B NONCE_OR_SALT | 8B TIMESTAMP_OR_RESERVED]`; proof HMAC covers `[MAGIC | HOST_PUB | CLIENT_PUB | NONCE_OR_SALT | TIMESTAMP]` (including timestamp so expiry cannot be stripped/extended). Server must validate `abs(now - timestamp) <= HANDSHAKE_TTL_SEC` and fail closed once established (`complete_handshake()` rejected if already established or `closed`).
   - **Directional Keys (Anti-Reflection Mandatory)**: Derive **two separate 32-byte keys** via HKDF-SHA256 using distinct `info` context strings (`CTX_CLIENT_TX` and `CTX_HOST_TX` — matching `crypto_vault.py` & `crypto_engine.dart`). **Do NOT** use a single shared `_sessionKey` (`crypto_channel.dart` & `crypto_handshake.py`) without direction key separation AND nonce sender tag validation.
2. **AEAD Frame Encryption & Nonce Layout**:
   - Cipher: `ChaCha20-Poly1305` (RFC 8439), 32-byte directional key, 12-byte nonce, 16-byte Poly1305 tag, **12-byte wire header as AAD**.
   - Nonce format (standardized across sides): `12` bytes encoding `(monotonic_uint64_counter, 4B_sender_tag)` (or `(uint32_epoch, uint64_seq)`), with TX counter starting at `1` (`>= 1` strictly, auto-incremented internally — never allow caller `seq=0` or reuse of `(key, nonce)`). Receiver MUST verify the sender tag does not match its own role tag.
3. **Post-MAC Anti-Replay Rule (MANDATORY — No Pre-MAC DoS)**:
   - Receivers (`crypto_channel.dart`, `crypto_engine.dart`, `crypto_vault.py`, `networkWorker.ts`) MUST validate replay window bounds non-mutatingly **before** decrypting, then run **ChaCha20-Poly1305 MAC verification (`decrypt`) FIRST**, and **commit `_rxLastNonceCounter` / `SlidingWindowReplayGuard` / `replayBitmap` ONLY AFTER MAC authentication succeeds**.
   - Reject `seq <= 0` for all post-auth data/telemetry/frame packets. `agent.py` MUST increment monotonic per-connection/stream sequence numbers (`frame_seq >= 1`, `telem_seq >= 1`) rather than emitting `seq=0`.

### 3.3 Transport Honesty & WebSocket Mode

- UI components (`ScreenViewerModal.tsx`, `WsConfigModal.tsx`, `HostCard.tsx`) MUST accurately label `wss://` (TLS) vs cleartext LAN `ws://`. Never hardcode `"TLS 1.3"` banners on unencrypted `ws://` connections.
- `AndroidManifest.xml` (`usesCleartextTraffic`) and release configs must document LAN plaintext risk vs `wss://` or AEAD payload wrapping (`flags & 0x02`).

---

## 4. PSK, Pairing PIN & Secret Management Rules

1. **Zero Hardcoded Fallback Secrets**:
   - The strings `"ai_netcontroller_secret_2025"`, `"cst_autonomous_lan_secret_2025"`, `"cst_thesis_2026_secret_key"`, `"CST_SECURE_TOKEN_2026"`, and `"847291"` MUST NOT exist anywhere in runtime source, web bundles, or fallback branches (`agent.py`, `agent_daemon.py`, `daemon_config.py`, `server.ts`, `networkWorker.ts`, `QuickSetupModal.tsx`, `PcDaemonGuiModal.tsx`, `viewport_stream_widget.dart`, `crypto_engine.dart`).
   - On first run without env overrides (`AI_AGENT_SECRET` / `CST_AGENT_SECRET`), `agent/daemon_config.py` generates a high-entropy CSPRNG pairing secret (`>= 24–32` hex/url-safe chars) and persists it under `threading.RLock` + atomic `os.replace()`.
2. **Single Synchronized Credential Source & Instant Revocation**:
   - `HostAgentDaemon`, `HostDaemonState`, `DaemonServer`, and `server.ts` MUST read the active credential from the canonical `daemon_config.py` store (`%LOCALAPPDATA%\AI NetController\config.json` / `~/.ai_netcontroller/config.json`).
   - Rotating a token or PIN MUST revoke the prior secret cleanly rather than keeping revoked credentials valid inside `_get_valid_secrets()` or RAM-only copies overwritten on the next read.
3. **At-Rest Protection & Secret Hygiene**:
   - Config files MUST enforce restrictive permissions (`0o700` dir / `0o600` file on POSIX; user-scoped ACLs / Windows DPAPI `CryptProtectData` recommended for stored `pairing_token`).
   - PINs (6-digit OTPs) MUST be rate-limited/locked out on brute force (including headless mode), expire after a short window, require interactive/QR pairing confirmation rather than silently acting as permanent secrets, and **never** appear in URL query params (`?pair_token=...` — use URL fragments `#` or short-lived one-time pairing codes), console/UI audit logs, or unauthenticated HTTP JSON (`/api/daemon/state`, `/api/setup/info`).
   - Web backend `server.ts` binds `127.0.0.1` by default (explicit opt-in `ALLOW_LAN_WEB`), restricts CORS via explicit `ALLOWED_ORIGINS` (never wildcard `*` or `*.run.app`), and authenticates `/api/*` state/control routes via `requireControlAuth` / constant-time bearer or loopback session verification.

---

## 5. Human-in-the-Loop (HITL) Gate Rules

All dangerous or mutating command paths share these non-bypassable invariants across Web, Mobile, Server, and Agent:

1. **Three-Tier Risk Verdict Contract**:
   - `SAFE`: Allowed for direct sandboxed execution.
   - `REQUIRES_BIOMETRIC` / `HOLD_CONFIRMATION` (includes shutdown/reboot/sleep presets, privilege/firewall/service changes, obfuscated/encoded/dynamic shell syntax, path traversal): **MUST NOT** execute without explicit interactive approval.
   - `BLOCKED` (catastrophic filesystem wipes, boot/BCD destruction, credential dumps, fork bombs): **MUST BE HARD-REJECTED UNCONDITIONALLY** at both firewall (`CommandASTFirewall`) and agent (`agent.py`) layers. `BLOCKED` verdicts MUST NEVER be downgraded into HITL approval prompts.
2. **Web Client HITL Invariants (`useWorkerEngine.ts`, `HitlApprovalModal.tsx`, `securityService.ts`)**:
   - `useWorkerEngine.ts` MUST gate `verdict.requiresHoldConfirmation` when **`isConnected` is true** (NEVER inverted `!isConnected`).
   - Quarantine checks MUST use a strict allowlist (e.g., exact status query), **never** substring matching like `!prompt.toLowerCase().includes('status')`.
   - Client-side `securityService.ts` is UX pre-flight feedback only; security authority resides strictly in `agent/command_ast_firewall.py` and `HostAgentDaemon`.
3. **Web Server Invariant (`apps/web/server.ts`)**:
   - Never accept client-supplied `{ confirmed: true }` to bypass HITL in HTTP endpoints (`POST /api/command/execute`), never execute local `exec()` shell commands bypassing `agent.py`, and never allow unauthenticated flipping of `requireHitlApproval`. Route host commands to an authenticated agent session or return `501/503`.
4. **Python Agent & Firewall Invariants (`agent/agent.py`, `agent/command_ast_firewall.py`, `agent/agent_gui.py`)**:
   - `CommandASTFirewall.execute_sandboxed(..., biometric_approved=False)` MUST refuse `risk == "REQUIRES_BIOMETRIC"` unless `biometric_approved=True` is explicitly passed after verified approval.
   - Server generates unique unpredictable `approval_id` and `challenge_nonce` (never trust client `command_id` as `pending_approvals` key without isolation).
   - Under `strict` security profile (`Zero-Trust Strict`), **only local host operator approval** (`resolve_local_hitl` invoked from `agent_gui.py` local modal) may resolve a pending future; remote `OP_HITL` responses are ignored.
   - Under standard profile, remote `OP_HITL` responses MUST match the originating `ws` session **AND** carry a constant-time `HMAC-SHA256(secret, "${approval_id}:${nonce}:${command}")` signature. Unsigned `{ "approved": true }` messages MUST be rejected.

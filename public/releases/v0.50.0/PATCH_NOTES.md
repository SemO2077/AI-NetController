# AI NetController Beta 0.50.00 (`v0.50.0`) — Release Notes

**AI NetController Beta 0.50.00 (`v0.50.0`)** is a comprehensive security hardening, bug-fix, and realism release across the Windows/Linux Python Host Agent, Express Control Server, React Web Console, and Android Companion App.

---

## Highlights & Fixes in Beta 0.50.00

### 1. Security Hardening & Credential Hygiene
- **Zero Hardcoded Fallback Secrets**: Removed all static/default fallback shared secrets across the Python Host Agent, Node Control Server, Flutter/Dart WebSocket client, and build/code snippets. Pairing secrets are generated dynamically at runtime (`secrets.token_hex`) and sealed on Windows via DPAPI (`agent/crypto_vault.py`).
- **Cryptographic Handshake & Anti-Replay Enforcement**:
  - Updated Flutter `Curve25519` / `X25519` scalar clamping (RFC 7748 bit 255) and ensured Poly1305 AEAD tag verification completes **before** advancing sliding-window / monotonic replay watermarks.
  - Enforced strict `'AUTH_OK'` / `'OK_AUTHENTICATED'` handshake matching (closing fail-open substring matches).
  - Enforced directional session keys (`tx` / `rx`) and non-failing hardware biometric gating when biometrics are required.
- **Loopback Web & Android Bridge Hardening**:
  - Added strict `Host` header, `Origin` check, and `HttpOnly; SameSite=Strict` session cookies to the Express Control Server and the Android embedded local HTTP bridge (`MainActivity.java`).
  - Removed permissive `Access-Control-Allow-Origin: *` headers on the Android bridge, gated `WebView.setWebContentsDebuggingEnabled` behind `FLAG_DEBUGGABLE`, disabled WebView file access, and replaced prefix-based URL allowlisting with exact `Uri.parse()` host + port matching.
- **Command AST Firewall & Process Sandbox**: Hardened Python & TypeScript command inspection and environment variable scrubbing before spawning child processes.

### 2. Wire Protocol Alignment & Bug Fixes
- **Canonical Opcode Table (`AI-NET/3.0-SECURE`)**: Resolved opcode collisions across Python, TypeScript, and Dart (`OP_LLM_STREAM = 0x0B`, `OP_DISPLAY_ENUM = 0x0D`, `OP_FRAME_SYNC = 0xED`, `OP_ERROR = 0xEE`).
- **Android Bridge & Native Build Pipeline**:
  - Migrated Android APK HTTP JSON parsing/serialization to framework `org.json.JSONObject` / `JSONArray` and added `try-with-resources` + timeouts for ARP table subprocess inspection.
  - Updated Android SDK/JDK resolution (`ANDROID_HOME`/`ANDROID_SDK_ROOT` & `JAVA_HOME` priority), `versionCode 500` / `versionName "0.50.00-beta"`, and env-configurable release keystore signing.
  - Eliminated synthetic APK stub fallback in `scripts/build_release_binaries.py` and added native GitHub REST API artifact upload support to `scripts/publish_github_release.py`.

### 3. Removal of Fake Mocks, Stubs & Synthetic Telemetry
- **No Fabricated Responses**: Removed canned stub AI chat replies, fake PC execution confirmations, hardcoded latency numbers, synthetic heartbeat waves, and simulated window stubs across web components and the Android local server. Live diagnostics, Gemini API requests, and Wake-on-LAN sweeps execute directly against configured endpoints and hardware.
- **UI & Workflow Fixes**: Added HITL confirmation re-submission in `GeminiChatbot.tsx`, two-click confirmation for schedule deletion/reset in `WolModal.tsx`, live clearing of wake countdowns upon host online detection in `FleetDashboard.tsx`, and honest error reporting when unconfigured or offline.

---

## Release Deliverables (`v0.50.0`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.50.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with system tray & GUI |
| `AI_NetController_HostAgent_v0.50.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent build, source, and launchers |
| `AI_NetController_v0.50.0_arm64-v8a.apk` | Android 10–15 (arm64-v8a) | Signed native Android APK package (`0.50.00-beta`) |
| `AI_NetController_v0.50.0.apk` | Android Universal | Signed universal APK package (`0.50.00-beta`) |
| `SHA256SUMS.txt` | All | SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All | Machine-readable release metadata and asset manifest |

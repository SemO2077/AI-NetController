# AI NetController Beta 0.51.00 (`v0.51.0`) — Release Notes

**AI NetController Beta 0.51.00 (`v0.51.0`)** is a minor feature and reliability release focused on end-to-end verification between the Python Host Daemon (`agent/`), Express/React Control Console (`apps/web/`), and native Flutter Mobile Client (`apps/mobile/`).

---

## Highlights & Fixes in Beta 0.51.00

### 1. Host Daemon End-to-End Verification & Handshake Fixes (`agent/`)
- **OP_AUTH 16-Byte ACK Fix**: Resolved the `OP_AUTH` acknowledgment frame collision so binary clients cleanly negotiate authenticated directional sessions without desynchronization.
- **Lifecycle & Teardown Hygiene**: Added explicit `async_stop()` cleanup, `enable_tray` / `enable_mdns` toggles for headless execution and CI environments, and ensured `_close_vaults_and_approvals()` clears `_client_secrets` and `_client_outbound_seq`.
- **Full-Feature Daemon Verification (`agent/tests/test_daemon_full_features.py`)**: Verified live binary framing, HMAC/ECDH authentication, system telemetry streaming, multi-monitor desktop capture, AST firewall enforcement, HITL approval flow, and graceful shutdown.

### 2. Flutter Mobile Client & Live Daemon E2E (`apps/mobile/`)
- **Live Protocol Alignment**: Synchronized the Flutter binary WebSocket client and dashboard telemetry pipeline with the Python Host Daemon.
- **Dashboard & Layout Fixes**: Resolved responsive UI overflow issues in the Flutter dashboard views.
- **Live Daemon E2E Test Suite (`apps/mobile/test/daemon_mobile_e2e_test.dart`)**: Verified Flutter unit tests and live Flutter-to-Python daemon connection & telemetry end-to-end.

### 3. Release Tooling & Dynamic Versioning (`scripts/`)
- Dynamically derives beta labels (`Beta 0.XX.YY` / `0.XX.YY-beta`) across `scripts/build_android_app.py`, `scripts/build_release_binaries.py`, `scripts/publish_github_release.py`, and `scripts/update_release_manifest.py`.
- Bumped package manifests across Node/Web (`0.51.0`), Python Host Agent (`0.51.0` / PE `0.51.0.0`), and Android/Flutter (`0.51.0+510` / `versionCode 510`).

---

## Release Deliverables (`v0.51.0`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.51.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with system tray & GUI |
| `AI_NetController_HostAgent_v0.51.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent build, source, and launchers |
| `AI_NetController_v0.51.0_arm64-v8a.apk` | Android 10–15 (arm64-v8a) | Signed native Android APK package (`0.51.00-beta`) |
| `AI_NetController_v0.51.0.apk` | Android Universal | Signed universal APK package (`0.51.00-beta`) |
| `SHA256SUMS.txt` | All | SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All | Machine-readable release metadata and asset manifest |

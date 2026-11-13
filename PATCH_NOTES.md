# AI NetController Beta 0.60.00 (`v0.60.0`) — Release Notes

**AI NetController Beta 0.60.00 (`v0.60.0`)** is a major unified milestone combining security hardening, native performance optimization, persistent user preferences, Cyber Glass desktop/mobile UI upgrades, and Smart-App-Control-aligned packaging across all three components (`apps/mobile/`, `agent/`, and `apps/web/`).

---

## Highlights in Beta 0.60.00

### 1. Mobile Companion Security, Performance & Persistent Memory (`apps/mobile/`)
- **Android Keystore Hardware Vault (`SecureSecretStore` & `MainActivity.kt`)**:
  - Stores host pairing secrets using Android Keystore hardware-backed AES-GCM via native `MainActivity.kt` `MethodChannel`, with automatic migration and scrubbing of legacy Hive secrets.
- **Zero-Trust Transport & Mutual AEAD Vault (`HostConnectionClient`, `CryptoEngine`)**:
  - Added optional `wss://` TLS with SHA-256 certificate fingerprint pinning, mutual 91-byte X25519+HMAC (`INIT_ECDH_VAULT_M`), `CST_ECDH_V2` AEAD frames (`encryptWirePacket`/`decryptWirePacket`), post-vault anti-downgrade enforcement, and encrypted `PAIR_INIT`/`PAIR_FINISH` (`PairingResult`).
  - Resolved the `OK_AUTHENTICATED` 16-byte length collision in `HostConnectionClient` where 16 ASCII bytes matched a 16-byte challenge nonce; status string evaluation now runs first alongside `_authChallengeResponded` tracking.
- **Performance, Framing & Zero-GC Video Pipeline**:
  - Optimized 26-bit limb `ChaCha20Poly1305` (`encryptInto`), 6-byte binary `OP_INPUT` coalescing (`16ms`), synchronous `NetworkFramer` broadcast (`sync: true`) with bounded interval-tracked `PacketReassembler`, and lazy-exponential `_DoubleFrameRingBuffer` (64KB → 4MB) with 1500ms keyframe resync cooldown (`zero_gc_video_pipeline.dart`).
  - Removed unused `shader_warmup.dart`, refined ProGuard/R8 rules (`build.gradle`, `proguard-rules.pro`), and hardened `AndroidManifest.xml`.
- **Persistent Preferences, Appearance Studio & Responsive Fixes**:
  - Added Hive-backed `AppPreferencesNotifier` (`app_preferences.dart`) persisting `CyberAccentPreset`, `GlassIntensity`, dark/AMOLED toggle, target FPS, TLS preference, custom scan port, haptic feedback toggle, onboarding completion, and deduplicated 25-entry command history.
  - Applied dynamic `CyberPalette` (`fluid_theme.dart`) across screens, persisted host/vault entries in `FleetNotifier`, added `BiometricSecurityGate` persistence and `NetworkValidators` input/URI/MAC/risk checks, localized strings in `file_transfer_engine.dart` and `os_integrations_manager.dart`, and fixed responsive layouts and disconnect state (`responsive_device_card.dart`, `adaptive_layout_builder.dart`, `pip_stream_viewer.dart`, `onboarding_sheet.dart`, `viewport_stream_widget.dart`).

### 2. Host Daemon Security, Screen Capture & Windows Packaging (`agent/`)
- **Daemon Hardening (`tls_manager.py`, `agent.py`, `agent_daemon.py`)**:
  - Auto-generated SAN ECDSA TLS certificates with SHA-256 fingerprint pinning, mutual 91-byte `INIT_ECDH_VAULT_M` handshake, workstation lock auto-pause, static-frame short-circuit, NumPy resize caching, and 4:2:0 chroma subsampling in `AdaptiveScreenPipeline`, plus hardened IPC supervision.
- **Command AST Firewall, DPAPI Config & Safe File Writes**:
  - Enhanced `command_ast_firewall.py` with Unicode NFKC and caret normalization, LOLBin/cradle interception, `ri`/`rp`/`spps` blocking, and thread-safe bounded `OrderedDict` inspection cache.
  - Upgraded `daemon_config.py` (Windows DPAPI secret sealing, weak PIN rejection, security profiles) and `host_file_writer.py` (disk reservation and Win32 Mark-of-the-Web ADS tagging).
- **Smart-App-Control-Aligned Distribution (`windows_integration.py`, `build_agent.spec`, `AppxManifest.xml`, `package_msix.ps1`)**:
  - Migrated Windows shortcut/service registration to native Win32 COM helpers without `taskkill`/`vbs`/`icacls` dropper patterns and added signed `--onedir` + MSIX packaging support.

### 3. Cyber Glass Desktop Control Center (`agent/agent_gui.py`, `agent/cyber_ui_theme.py`)
- Rebuilt the PC Desktop Control Center to visual parity with Mobile and Web: Abyssal Void (`#040812`) palette with Cyan (`#00F0FF`) and Violet (`#8A2BE2`) glows, orbital `CyberNodeBadge`, pure-Python ISO/IEC 18004 QR pairing card, PIN TTL rotation, Neon Coral HITL approval modal, and idle-aware frame rendering.

### 4. Web / WebView Persistent Bridge & Unified v0.60.0 Release (`apps/web/`, `scripts/`)
- Added persistent native/WebView storage bridge (`apps/web/src/utils/nativeStorage.ts`) integrated into `uiStore.ts`, `useFleetState.ts`, `wolService.ts`, and Android `MainActivity.java`.
- Unified package manifests across Node/Web (`0.60.0`), Python Host Agent (`0.60.0` / PE & MSIX `0.60.0.0`), and Android/Flutter (`0.60.0+600` / `versionCode 600` / `0.60.00-beta`).

---

## Release Deliverables (`v0.60.0`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.60.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with system tray & GUI |
| `AI_NetController_HostAgent_v0.60.0_win64_portable.zip` | Windows x64 | Signed `--onedir` archive containing Host Agent build, source, and MSIX manifest |
| `AI_NetController_v0.60.0_arm64-v8a.apk` | Android 10–15 (arm64-v8a) | Signed native Android APK package (`0.60.00-beta`) |
| `AI_NetController_v0.60.0.apk` | Android Universal | Signed universal APK package (`0.60.00-beta`) |
| `SHA256SUMS.txt` | All | SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All | Machine-readable release metadata and asset manifest |

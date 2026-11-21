# Changelog

All notable changes to **AI NetController** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v0.90.0] (Beta 0.90.00) - 2026-11-22

### Performance, Screen Streaming & Low-Latency Input
- **Zero-Copy Strided `BGRX` Capture, Dynamic `TurboJPEG` Discovery & Credit-Based `OP_FRAME_ACK` (`0x0E`) (`agent/agent.py`, `agent/multi_monitor_streamer.py`)**:
  - Added optional Windows DXGI Desktop Duplication (`dxcam` / `bettercam`) with thread-local `mss` fallback, reusable `(out_h, out_w, 4)` `TJPF_BGRX` downscale and `_work_bgra` cursor buffers, automatic `libturbojpeg` DLL discovery (`_discover_turbojpeg`), progressive static-frame backoff (`16ms..160ms` max), and off-loop `CryptoTx` thread-pool ChaCha20-Poly1305 encryption for `OP_FRAME >= 16 KiB`.
  - Added a 2-frame credit window (`OP_FRAME_ACK = 0x0E` with `frame_seq` and `decode_time_us`, `350ms` stall reset, and `128 KiB` socket write-buffer cap) and snapshot-only `OP_VIEWPORT_RESIZE` (`"snapshot": true`) capture (`capture_snapshot`).
- **Direct Win32 `SendInput` & Coalesced 60Hz Binary Touch Injection (`agent/agent.py`)**:
  - Added `InputInject` direct `ctypes.windll.user32.SendInput` mouse/keyboard synthesis on Windows (`0..65535` normalized coordinates across single and virtual multi-monitor desktops) and non-blocking latest-move coalescing for binary pointer move frames (`event_type == 4`).
- **Mobile Background Decrypt Isolate & Immediate Frame Ack (`apps/mobile/lib/services/frame_decrypt_isolate.dart`, `host_connection_client.dart`, `zero_gc_video_pipeline.dart`)**:
  - Offloaded `CST_ECDH_V2` ChaCha20-Poly1305 decryption and `PacketReassembler` chunk stitching for `OP_FRAME` packets onto a persistent Dart background `Isolate` (`FrameDecryptIsolate`), removed socket pause/resume stalls on video frames, decoupled `OP_FRAME_ACK` / `OP_FRAME_SYNC` to fire immediately after `ui.instantiateImageCodec`, and raised touch move dispatch to `60Hz` (`16ms`).

### Mobile Fleet Cards, Direct Touchscreen & Command-Deck Settings Redesign
- **Direct Touchscreen Control, Immersive Fullscreen & Remote Keyboard Bar (`apps/mobile/lib/ui/touch_coordinate_mapper.dart`, `touch_feedback_overlay.dart`, `fullscreen_stream_page.dart`, `remote_keyboard_bar.dart`, `viewport_stream_widget.dart`)**:
  - Added Direct Touchscreen absolute coordinate mapping (pinch-to-zoom `1.0x–4.0x`, 2-finger pan/scroll, tap, double-tap, long-press right-click with radial hold ring, 1-finger drag) alongside relative Trackpad mode, `FullscreenStreamPage` with auto-collapsing translucent HUD, and slide-up `RemoteKeyboardBar` with sticky modifiers (`Ctrl`, `Alt`, `Shift`, `Win`), `F1–F12`, arrows, and system shortcut macros.
- **Expandable Home Screen PC Cards with Live Screen Preview (`apps/mobile/lib/ui/responsive_device_card.dart`, `host_snapshot_preview.dart`, `main.dart`)**:
  - Added single-accordion inline card expansion on the Fleet Home screen revealing an auto-refreshing 16:9 `HostSnapshotPreview` (1-tap launch to `FullscreenStreamPage`, manual refresh, offline WoL fallback), detailed CPU/RAM/IP/MAC/OS/Latency telemetry grid, and quick action pills.
- **Ground-Up Settings Command-Deck Hub, Dedicated WoL Hub & Unified Activity History (`apps/mobile/lib/ui/settings_command_deck.dart`, `wol_hub_panel.dart`, `activity_history_panel.dart`, `services/history_store.dart`, `services/app_preferences.dart`)**:
  - Rebuilt the Settings tab into a 5-section Command-Deck (`Quick Ops`, `Remote & Stream`, `Security & AI`, `Appearance`, `System & Backup`) with instant search, `"Modified"` badges, per-section reset, and **Appearance Studio** positioned in the lower half (`Section 4`).
  - Added `WolHubPanel` (saved target picker, custom MAC/Broadcast/Port dispatch, Wake All Fleet, persistent Recent WoL Dispatches with 1-tap Re-Send), Hive-backed `ActivityHistoryPanel` (`All`, `Commands`, `Connections`, `WoL` with 1-tap Re-Run/Copy & JSON export), advanced touch/stream preferences, and secret-stripping JSON Config Backup & Restore.

### Discovery, Tooling & Build Hardening
- **Zero-Config LAN UDP Discovery (`CST_DISCOVER_V1`) & 5-Stage Connection Diagnostics (`agent/agent.py`, `apps/mobile/lib/services/lan_discovery_service.dart`, `ui/connection_diagnostics_sheet.dart`)**:
  - Added UDP 8766 broadcast/unicast discovery responder and interactive 5-stage connection diagnostics sheet.
- **1-Click Builders, Live Verification Orchestrator & Flutter 3.50 / AGP 9.3.1 Built-in Kotlin Compliance (`BUILD_APK.bat`, `BUILD_EXE.bat`, `LAUNCH_AND_TEST.bat`, `scripts/launch_and_test_daemon.py`, `apps/mobile/android/`)**:
  - Added root convenience builders and live E2E daemon verification script, removed imperative `id "kotlin-android"` from `apps/mobile/android/app/build.gradle`, replaced legacy `home_widget` plugin with native `MethodChannel("com.cst.autonomouslan/home_widget")` in `MainActivity.kt`, and hardened `--no-pub` release plugin registrant regeneration.
- **Unified `v0.90.0` (`Beta 0.90.00` / `0.90.00`) Release**: Bumped all Node/Web (`0.90.0`), Python Host Agent (`0.90.0` / PE & MSIX `0.90.0.0`), Flutter/Android (`0.90.0+900` / `versionCode 900` / `0.90.00-beta`), documentation, and release artifacts/manifests.

---

## [v0.80.0] (Beta 0.80.00) - 2026-11-19

### Security & Hardening
- **Full-Stack Mutual X25519 + ChaCha20-Poly1305 AEAD Vault (`agent/`, `apps/web/`, `apps/mobile/`)**:
  - Upgraded the Web Control Server (`apps/web/server.ts`) and WebWorker binary transport (`apps/web/src/workers/networkWorker.ts`, `apps/web/src/utils/cryptoVault.ts`) to negotiate mutual 91-byte `INIT_ECDH_VAULT_M` handshakes with HKDF-SHA256 directional session keys and `CST_ECDH_V2` ChaCha20-Poly1305 AEAD wire frames, matching the Flutter Mobile and Python Host Agent vaults.
  - Added post-vault downgrade enforcement (`HostAgentDaemon._aead_required()`) and fail-closed `require_aead` gating so plaintext control frames are rejected once an AEAD session or strict profile is active.
  - Implemented end-to-end encrypted `CST-PAIR-X25519-V1` ephemeral PIN pairing (`apps/web/src/services/pairCrypto.ts`, `agent/agent.py`, `apps/mobile/lib/services/host_connection_client.dart`) so pairing tokens never traverse the LAN in plaintext.
- **SSRF, DNS Rebinding & Payload Boundary Protections**:
  - Added strict RFC 1918 / RFC 4193 private-LAN target validation (`apps/web/src/utils/networkGuard.ts`, `apps/web/server.ts`, `apps/mobile/lib/security/network_validators.dart`) blocking cloud metadata endpoints (`169.254.169.254`), public internet targets, and unbracketed IPv6 ambiguity.
  - Hardened `apps/web/server.ts` against DNS rebinding via strict `Host` header allowlisting (`isAllowedHostHeader`), added constant-time `crypto.timingSafeEqual` secret comparisons, sanitized `/api/source-files` against path traversal and `.env` leakage, and enforced an 8192-byte shell command bound and 1 MiB clipboard payload bound in `agent/agent.py`.
- **Expanded Command AST Firewall (`agent/command_ast_firewall.py`)**:
  - Added high-risk PowerShell cmdlets (`set-mppreference`, `invoke-wmimethod`, `invoke-cimmethod`, `new-service`, `set-service`, `add-content`, `clear-eventlog`, `remove-eventlog`, `export-pfxcertificate`) and hardened quote-stripping tokenization so multi-word destructive patterns cannot be bypassed via inline quotes.
- **Mobile & Android Platform Hardening (`apps/mobile/`)**:
  - Enforced hardware-backed `SecureSecretStore` (Android Keystore AES-GCM) on Android builds without silent Hive plaintext fallback, wired `BiometricSecurityGate` into `_confirmRiskyCommand` before `sendHitlResponse(true)` or risky command execution, added Android 12+ `<data-extraction-rules>` excluding sensitive boxes from cloud backup/device-transfer, and removed wildcard CORS (`Access-Control-Allow-Origin: *`) from the Android WebView loopback server (`MainActivity.java`).

### Performance & Screen Streaming
- **Zero-Bufferbloat 60 FPS Screen Streaming Pipeline (`agent/agent.py`, `agent/multi_monitor_streamer.py`)**:
  - Enabled Windows Per-Monitor V2 DPI awareness (`SetProcessDpiAwarenessContext(-4)`), `TJFLAG_FASTDCT` SIMD JPEG compression, 2D strided (`img32[::8, ::16]`) static-screen delta detection with 1 high-quality settling frame, thread-local `mss` auto-recovery on Desktop Switch/UAC events, and explicit `OP_FRAME_SYNC`-gated single-in-flight frame delivery (`_send_frame_guarded`) preventing TCP bufferbloat.
  - Updated `MultiMonitorStreamer` to reuse a thread-local `mss` instance and encode frames via `TurboJPEG` (`4:2:0` chroma subsampling) before falling back to Pillow.
- **Hardware-Accelerated Web `<canvas>` & Mobile Impeller Rendering (`apps/web/`, `apps/mobile/`)**:
  - Upgraded Web `ScreenViewerModal.tsx` and `screenStore.ts` to decode binary JPEG frames off the React render cycle via `createImageBitmap` + `requestAnimationFrame` onto a hardware-accelerated `<canvas>` with zero Blob URL leaks, live FPS badge, and 150ms debounced `ResizeObserver` viewport negotiation.
  - Upgraded Flutter `ZeroGcVideoPipeline` with copy-on-write ring-buffer concurrency protection (`writeSlot == readSlot`), single-flight `ui.instantiateImageCodec` hardware decoding, and lifecycle-aware `AppLifecycleState` pause/resume of `FrameSync` timers in `ViewportStreamWidget`.
  - Optimized LAN discovery in `apps/mobile/lib/main.dart` to scan local `/24` RFC 1918 subnets cleanly without spawning redundant fallback isolate waves.

### Ergonomics & User Experience
- **Frictionless Pairing & Universal Deep Links**:
  - Added `ainet://pair` custom scheme intent filter and MethodChannel bridge (`MainActivity.kt` -> `main.dart`) alongside clipboard pairing link detection (`ainet://pair` and `#pair_ip=`), unmasked 6-digit PIN entry with auto-submit, and automatic PIN pairing prompt when tapping an unpaired LAN host.
  - Added inline 1-click **Quick Pair (6-Digit PIN)** directly inside the Web `ScreenViewerModal` overlay, plus **Monitor Switcher**, **Pull/Push PC Clipboard Sync**, **Double-Click**, and an inline **AI Approval Bar** for pending `OP_HITL` requests.
- **Launchers & Cross-Platform Parity**:
  - Fixed `START_HERE_WINDOWS.bat` and `START_HERE_LINUX.sh` to auto-open `http://localhost:3000` and execute `agent/agent.py` with proper PYTHONPATH resolution.
  - Wired global `PANIC_KILL_ALL` across Mobile, Web, and Host Agent to immediately terminate running child processes and revoke active sessions.

### Changed
- **Unified `v0.80.0` (`Beta 0.80.00` / `0.80.00`) Release**: Bumped all Node/Web (`0.80.0`), Python Host Agent (`0.80.0` / PE & MSIX `0.80.0.0`), Flutter/Android (`0.80.0+800` / `versionCode 800` / `0.80.00-beta`), documentation, and release artifacts/manifests.

---

## [v0.70.0] (Beta 0.70.00) - 2026-11-14

### Added & Rebuilt
- **Rebuilt Flutter Mobile Companion (`apps/mobile/`)**: Rebuilt client architecture from the ground up, removed redundant code, added 3D beveled Cyber Glass surfaces with fluid micro-animations, and refined viewport/aspect-ratio scaling across `280x653` to `1440x900` displays.
- **Host Daemon Setup Wizard & Feature Customizer (`agent/`)**: Upgraded desktop Control Center (`CyberUITheme`), added a 2-column feature customizer and 3-step Guided Setup Wizard, and added user toggles for Run on Startup, File Transfer, Audio Control, Ollama Bridge, Start Minimized, Close to Tray, Target FPS, and daemon Pause state.
- **Professional Install/Uninstall & 3D Branding**: Added Win32 Add/Remove Programs lifecycle and `MoveFileExW` deferred self-delete cleanup (`windows_integration.py`), stamped 3D Cyber-Glass icons onto Windows EXEs and Android APKs (`build_android_app.py`), and enabled onefile SFX `.EXE` packaging (`build_agent.spec`, `build_release_binaries.py`).
- **End-to-End Web & Android Bridge Parity**: Synchronized all `/api/daemon/action` operations (including autostart registry sync, client trust/input toggles, `DISCONNECT_CLIENT`, security profiles, and pause controls) across `apps/web/server.ts`, `agent/daemon_config.py`, `agent/agent.py`, `agent/agent_gui.py`, and `apps/mobile/android_webview_shell/src/com/cst/autonomouslan/MainActivity.java`.

### Changed & Upgraded
- **Full-Stack Dependency Upgrades**:
  - Updated Python packages (`agent/requirements.txt`) to latest (`websockets>=17.4`, `zeroconf>=0.154.0`, `Pillow>=13.0.0`, `numpy>=2.5.4`, `PyTurboJPEG>=2.6.1`, `cryptography>=50.0.2`, `psutil>=7.2.2`, `pyinstaller>=6.22.3`).
  - Updated Flutter dependencies (`apps/mobile/pubspec.yaml`) to `flutter_riverpod ^3.5.0`, `local_auth ^3.0.2`, `home_widget ^0.10.0`, `network_info_plus ^8.2.2`, `sensors_plus ^7.1.1`, `share_plus ^13.3.1`, `wakelock_plus ^1.8.2`, `flutter_lints ^6.0.0`, migrating `BiometricSecurityGate` and Riverpod legacy providers.
  - Updated Web/Node dependencies (`package.json`) to `vite ^8.3.8`, `express ^5.3.0`, `typescript ^7.0.2`, `@google/genai ^3.3.0`, `@tailwindcss/vite ^4.3.5`, `lucide-react ^1.73.0`, `motion ^14.14.0`, `recharts ^3.10.1`, `zustand ^5.1.0`; updated `apps/web/vite.config.ts`, Express 5 wildcard routes in `apps/web/server.ts`, and `.github/workflows/ci.yml` to Node 22.
- **Unified `v0.70.0` (`Beta 0.70.00`) Release**: Bumped all Node/Web (`0.70.0`), Python Host Agent (`0.70.0` / PE & MSIX `0.70.0.0`), Flutter/Android (`0.70.0+700` / `versionCode 700` / `0.70.00-beta`), documentation, and release workflows/scripts.

---

## [v0.60.0] (Beta 0.60.00) - 2026-11-13

### Security & Hardening
- **Mobile Hardware Keystore & Zero-Trust Transport (`apps/mobile/`)**: Added Android Keystore AES-GCM secret storage (`SecureSecretStore` + `MainActivity.kt` MethodChannel) with legacy Hive secret migration; upgraded `HostConnectionClient` and `CryptoEngine` with optional `wss://` TLS + SHA-256 fingerprint pinning, mutual 91-byte X25519+HMAC (`INIT_ECDH_VAULT_M`), `CST_ECDH_V2` AEAD frames (`encryptWirePacket`/`decryptWirePacket`), post-vault anti-downgrade, and encrypted `PAIR_INIT`/`PAIR_FINISH` (`PairingResult`).
- **Host Daemon TLS, Firewall & Vault (`agent/`)**: Added `tls_manager.py` (SAN ECDSA TLS + SHA-256 pinning), mutual `INIT_ECDH_VAULT_M` and workstation-lock auto-pause in `agent.py`, hardened IPC supervision in `agent_daemon.py`, Unicode NFKC/caret normalization + LOLBin/`ri`/`rp`/`spps` blocking + bounded `OrderedDict` inspection cache in `command_ast_firewall.py`, DPAPI sealing + weak PIN rejection in `daemon_config.py`, and disk reservation + Win32 MotW ADS tagging in `host_file_writer.py`.
- **Smart-App-Control-Aligned Packaging**: Replaced legacy dropper patterns (`taskkill`/`vbs`/`icacls`) with Win32 COM shortcut helpers (`windows_integration.py`) and added `--onedir` + MSIX packaging (`AppxManifest.xml`, `package_msix.ps1`, `build_agent.spec`, `sign_binary.ps1`).

### Performance & Reliability
- **Mobile Engine & Wire Pipeline**: Fixed the critical 16-byte `OK_AUTHENTICATED` challenge-nonce collision in `HostConnectionClient`, switched `NetworkFramer` to synchronous broadcast (`sync: true`) with bounded `PacketReassembler`, optimized 26-bit limb `ChaCha20Poly1305` (`encryptInto`), added 6-byte binary `OP_INPUT` coalescing (`16ms`), switched `_DoubleFrameRingBuffer` to lazy-exponential growth (64KB → 4MB) with 1500ms keyframe cooldown, fixed disconnect UI state in `viewport_stream_widget.dart`, removed unused `shader_warmup.dart`, and refined R8/ProGuard rules.
- **Host Screen Capture**: Added static-frame short-circuiting, NumPy resize caching, and 4:2:0 chroma subsampling in `AdaptiveScreenPipeline`.

### Added & Visual Improvements
- **Persistent Mobile & Web Memory**: Added Hive-backed `AppPreferencesNotifier` (`app_preferences.dart`) persisting `CyberAccentPreset`, `GlassIntensity`, dark/AMOLED toggle, target FPS, TLS preference, custom scan port, haptic feedback toggle, onboarding completion, and 25-entry command history alongside dynamic `CyberPalette` (`fluid_theme.dart`), `FleetNotifier` persistence, `BiometricSecurityGate` persistence, and `NetworkValidators`; added `apps/web/src/utils/nativeStorage.ts` integrated with `MainActivity.java`, `uiStore.ts`, `useFleetState.ts`, and `wolService.ts`.
- **Cyber Glass Desktop Control Center**: Rebuilt `agent_gui.py` and `cyber_ui_theme.py` (`icon_assets.py`) with Abyssal Void (`#040812`), Cyan (`#00F0FF`)/Violet (`#8A2BE2`) ambient glows, orbital `CyberNodeBadge`, pure-Python ISO/IEC 18004 QR pairing card, PIN TTL rotation, Neon Coral HITL modal, and idle-aware rendering.
- **Responsive Layout & Localization**: Refined responsive Flutter widgets (`responsive_device_card.dart`, `adaptive_layout_builder.dart`, `pip_stream_viewer.dart`, `onboarding_sheet.dart`) and standardized English localization across `file_transfer_engine.dart` and `os_integrations_manager.dart`.

### Changed
- **Unified `v0.60.0` (`Beta 0.60.00`) Release**: Bumped all Node/Web (`0.60.0`), Python Host Agent (`0.60.0` / PE & MSIX `0.60.0.0`), Flutter/Android (`0.60.0+600` / `versionCode 600` / `0.60.00-beta`), documentation, and release scripts.

---

## [v0.51.0] (Beta 0.51.00) - 2026-11-13

### Fixed & Verified
- **PC Daemon Binary Protocol & Session Cleanup (`agent/agent.py`)**: Resolved `OP_AUTH` 16-byte acknowledgment frame collision during binary handshakes and ensured `_close_vaults_and_approvals` clears `_client_secrets` and `_client_outbound_seq` on shutdown (`async_stop()`).
- **Flutter Mobile Client (`apps/mobile/`)**: Aligned Flutter binary `OP_AUTH` / telemetry handling with the Python Host Daemon, resolved dashboard layout overflow issues, and added live Flutter-to-Python daemon end-to-end verification (`apps/mobile/test/daemon_mobile_e2e_test.dart`).
- **End-to-End Daemon Test Coverage (`agent/tests/test_daemon_full_features.py`)**: Added comprehensive live WebSocket, telemetry, AST firewall, HITL approval, remote input, file/clipboard, and shutdown test coverage alongside Linux/Windows headless CI compatibility (`enable_tray=False`, `enable_mdns=False`).

### Changed
- **Release Tooling & Version Bump (`0.51.0` / `v0.51.0`)**: Updated Python, Node/React, Flutter/Android (`versionCode 510`, `0.51.00-beta`), and release builder/publisher scripts to dynamically format beta release metadata for `v0.51.0`.

---

## [v0.50.0] (Beta 0.50.00) - 2026-11-12

### Security
- **Zero Hardcoded Credentials & Dynamic Secret Vaulting**: Eliminated hardcoded fallback shared secrets across the Python Host Agent, Express Control Server, Flutter/Dart mobile client, and reference code snippets. Host pairing tokens are generated dynamically per host and sealed with Windows DPAPI (`agent/crypto_vault.py`).
- **Cryptographic Handshake & Replay Hardening**: Fixed RFC 7748 bit-255 X25519 scalar clamping and Poly1305 AEAD tag verification order in `apps/mobile/lib/security/crypto_channel.dart` and `crypto_engine.dart` so replay windows only advance after authenticated decryption succeeds. Removed fail-open `'AUTH'` substring acceptance in `viewport_stream_widget.dart` and software fallback bypass in `biometric_security_gate.dart`.
- **Loopback Server & Android WebView Hardening (`apps/web/server.ts`, `scripts/build_android_app.py`)**: Enforced `Host`/`Origin` validation, `HttpOnly; SameSite=Strict` session cookies, strict `Uri.parse()` loopback host allowlisting, `FLAG_DEBUGGABLE`-gated WebView debugging, `setAllowFileAccess(false)`, and removed wildcard CORS on the Android embedded bridge.

### Changed & Fixed
- **Canonical Wire Protocol (`AI-NET/3.0-SECURE`)**: Aligned binary opcodes across Python, TypeScript, and Dart (`OP_LLM_STREAM = 0x0B`, `OP_DISPLAY_ENUM = 0x0D`, `OP_FRAME_SYNC = 0xED`, `OP_ERROR = 0xEE`).
- **Removal of Fake Stubs & Synthetic Data**: Removed canned AI chat replies, fake PC action acknowledgments, hardcoded model latency numbers, and synthetic heartbeat waveforms; wired real Gemini HTTPS requests, live `/proc/meminfo` Android host stats, and honest `400`/`501`/`503` errors when required services are unconfigured.
- **Release & Android Tooling**: Removed synthetic stub APK fallback in `scripts/build_release_binaries.py`, added native GitHub Releases REST API uploading in `scripts/publish_github_release.py`, updated Android builds to `versionCode 500` (`0.50.00-beta`) with `org.json` serialization, and bumped Win32/Web version metadata to `0.50.0`.

---

## [v0.35.0] - 2026-11-07

### Added
- **4-Mode Composited Background Engine (`App.tsx`, `index.css`, `uiStore.ts`)**: Added GPU-composited background animations with 4 selectable presets: *Liquid Plasma (`fluid`)*, *Northern Aurora (`aurora`)*, *Cyber Grid (`cyber`)*, and *Static Dark Void (`minimal`)*.
- **Collapsible Appearance Studio (`SettingsScreen.tsx`, `uiStore.ts`)**: Moved the Appearance, Surface Material & Background Studio to the base of the Settings screen with a persistent *Show Studio / Hide Studio* (`isCustomizationOpen`) toggle.

### Changed
- **Distinct Surface Material Presets (`index.css`)**: Re-engineered `Crystal Clear` (`0.20` alpha, `blur(26px) saturate(240%)`, bright rim highlight), `Balanced` (`0.52` alpha, `blur(18px)`), and `True Matte` (`100%` opaque `#0c1220` surface with `backdrop-filter: none` and zero specular sheen).
- **Settings View Restructuring (`SettingsScreen.tsx`)**: Added a 4-card Quick-Launch Command Bar (*Pair Phone & PC*, *PC Daemon Center*, *System & AI Center*, *Interactive Guide*) above a structured 2x2 settings grid.
- **Haptic Feedback Reduction**: Removed redundant `triggerHapticFeedback` calls when switching between navigation tabs and modal sub-tabs.

### Fixed
- **Dropdown Menu Stacking & Clipping (`SettingsScreen.tsx`, `FleetDashboard.tsx`, `index.css`)**: Added `.dropdown-menu-surface` with solid `#060b16` backing and elevated z-index stacking contexts (`z-[80]` / `z-[50]`) so dropdown menus never clip or bleed into adjacent cards.
- **System & AI Center Responsive Wrapping (`SystemUpdateModal.tsx`, `GeminiChatbot.tsx`, `ScreenViewerModal.tsx`, `CodeExportModal.tsx`)**: Unified modal scroll containers, added `min-w-0 flex-1` and `break-words` to headers, and converted component metadata strings into wrapping flex chips.

---

## [v0.34.0] - 2026-11-07

### Added
- **Translucent Material & Surface Shading**: Overhauled cards, controls, floating navigation bar, and modals with multi-stop refractive translucency (`backdrop-filter: blur(...) saturate(185%)`), specular rim highlights, and GPU-composited ambient lighting.
- **Appearance Customization Studio (`SettingsScreen.tsx` & `uiStore.ts`)**:
  - **6 Accent Color Palettes**: Switching between *Cyber Cyan*, *Ultraviolet*, *Bio Mint*, *Crimson Sunset*, *Solar Gold*, and *Vision Sapphire* (persisted to `localStorage` and mapped across Tailwind CSS tokens).
  - **4 Interface Typography Presets**: *Onest Geometric*, *Plus Jakarta Display*, *SF System Native*, and *JetBrains Tech Mono*.
  - **3 Translucency Modes**: *Crystal Clear*, *Balanced*, and *Deep Frosted*.
  - **3 Ambient Motion Modes**: *Vibrant Aurora*, *Subtle Glow*, and *Minimal Stealth*.
- **Telemetry Smoothing**: Upgraded CPU/RAM telemetry bars, host status badges, and the floating navigation dock with smooth spring transitions.

---

## [v0.33.0] - 2026-11-07

### Added
- **Wake-on-LAN SecureOn Password Support**: Added 6-byte hexadecimal `secureOn` password support (108-byte magic packets) to `/api/wol` on the Express backend (`apps/web/server.ts`), matching the native Android WoL broadcaster.
- **LOLBin & Environment Hardening**: Added Windows Living-off-the-Land Binary rules (`certutil -urlcache`, `bitsadmin /transfer`, `mshta`, `regsvr32 /i:http`) to both `apps/web/src/services/securityService.ts` and `apps/web/server.ts`, plus child-process secret scrubbing (`createSafeChildEnv`) across Node.js and Python command supervisors.

### Changed
- **Backend & Host Agent Performance Optimizations**:
  - Cached static host identifiers (`socket.gethostname()`, `platform.system()`) in `agent/agent.py` to eliminate redundant OS syscalls during the 2-second telemetry heartbeat loop.
  - Added O(1) fast-path packet inspection in `agent/network_fuzzer_shield.py` when fault injection is inactive.
  - Added 30-second in-memory caching for `/api/releases`, 5-second TTL caching for disk and NIC enumeration in `getDaemonSnapshot()`, and cached Python version probing in `apps/web/server.ts`.
- **Mobile Animation Optimization**: Replaced nested backdrop filters with solid dark surfaces to maintain high frame rates on lower-power devices.

### Fixed
- **Android Native Daemon State JSON Serialization**: Fixed a missing closing quote in `MainActivity.buildDaemonStateJson()` (`scripts/build_android_app.py`) that caused malformed JSON responses on `/api/daemon/state` and `/api/daemon/action`.
- **Android Local Asset Path Traversal**: Added `..` path traversal filtering and structured component fields to the Android embedded server.
- **Host Agent GUI Metric Counters**: Connected `commands_executed` and `frames_broadcast` counters in `agent/agent.py` to update metrics accurately in the Desktop Control Center GUI.

---

## [v0.32.0] - 2026-04-06

### Added
- **Adaptive Mobile Layout**: Redesigned mobile layout (`apps/web/src/App.tsx`, `apps/web/src/index.css`) with a responsive 4-tab bottom navigation bar on phones and an adaptive navigation rail on tablets and foldables.
- **Native Android Edge-to-Edge Display**: Updated `MainActivity.java` with window insets integration (`WindowCompat.setDecorFitsSystemWindows`), hardware-accelerated rendering, native haptic feedback, and explicit system bar styling.
- **Interactive Wi-Fi Spectrum Inspection**: Added touch-scrubbing channel inspection and live BSSID congestion filtering on mobile viewports.

### Changed
- **Repository Documentation Cleanup**: Standardized release naming (`AI NetController v0.xx.x`), removed stale documentation files, and updated setup and build guides.
- **Touch Ergonomics Polish**: Removed hover-dependent tooltips on touch devices, replaced desktop window controls with a compact mobile header, and converted modal windows into bottom sheets on mobile displays.

---

## [v0.31.3] - 2026-04-05

### Added
- **Persistent Onboarding State**: Saved onboarding completion state across sessions so returning operators navigate directly to the telemetry dashboard.
- **High-Contrast Telemetry Palette**: Improved chart legibility and status badge contrast across dark and OLED display profiles.

### Fixed
- Fixed version string mismatches across release manifests and mobile build scripts.

---

## [v0.31.2] - 2026-04-04

### Added
- **Responsive Viewport Scaling**: Added fluid typography and responsive container sizing from 320px mobile screens up to 4K desktop displays.
- **Android Hardware Back Navigation**: Wired Android system back gestures (`OnBackPressedCallback`) to close active drawers and modal dialogs before exiting the application.

### Fixed
- Fixed horizontal overflow in the packet capture table on narrow viewports.

---

## [v0.31.1] - 2026-04-02

### Added
- **Automated Release Packaging**: Added `scripts/build_release_binaries.py` and `scripts/build_android_app.py` for reproducible Windows `.exe`, portable `.zip`, and signed Android `.apk` builds with SHA-256 checksum generation.
- **Unified Application Branding**: Standardized application naming to **AI NetController** across Windows executables, Android manifests, and WebSocket handshakes.

### Changed
- Reorganized repository layout into `agent/`, `apps/web/`, `apps/mobile/`, `docs/`, `scripts/`, and `.github/workflows/`.

---

## [v0.30.0] - 2026-03-29

### Added
- **Native Android WebView Bridge**: Added an embedded `AndroidBridge` JavaScript interface supporting native LAN ping checks and device information queries.
- **Local LLM Provider Support**: Added native Ollama (`http://localhost:11434`) integration alongside Gemini API adapters.

### Fixed
- Fixed WebSocket reconnection backoff when transitioning between Wi-Fi networks on Android.

---

## [v0.29.0] - 2026-03-25

### Added
- **Offline Telemetry Ring Buffer**: Added an offline ring buffer in the Windows Host Agent to cache system metrics while disconnected from the control server.
- **mDNS Auto-Discovery**: Added automatic LAN host discovery (`_cst-agent._tcp.local.`) for pairing between the desktop agent and mobile app.

### Security
- Added HMAC-SHA256 payload verification and rate limiting on `/api/*` endpoints.

---

## [v0.28.0] - 2026-03-24

### Added
- **Wi-Fi Channel Congestion Engine**: Added 2.4 GHz, 5 GHz, and 6 GHz channel overlap calculation and BSSID signal-to-noise ratio telemetry.
- **Packet Flow Sequence Graph**: Added interactive TCP/UDP sequence diagrams and packet capture export.

---

## [v0.27.1] - 2026-03-23

### Fixed
- **Windows High-DPI Scaling**: Enabled Per-Monitor V2 DPI awareness in the Windows Host Agent wrapper so native dialogs render crisply on 125%–200% scaling profiles.
- **Privilege Fallback**: Fixed startup crash when running without Administrator privileges; the agent cleanly degrades to unprivileged monitoring.

---

## [v0.27.0] - 2026-03-22

### Added
- Initial beta release of **AI NetController**.
- Real-time bandwidth, latency, and system telemetry via `psutil` and binary WebSockets.
- Express + WebSocket control server and React telemetry dashboard.

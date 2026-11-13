# Changelog

All notable changes to **AI NetController** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

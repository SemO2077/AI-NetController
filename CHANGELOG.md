# Changelog

All notable changes to **AI NetController** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

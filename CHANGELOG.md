# Changelog

All notable changes to **AI NetController** are documented in this file.

## [v0.32.0] - 2026-04-06

### Added
- **Redesigned Mobile UI**: Complete visual overhaul of the mobile layout (`apps/web/src/App.tsx`, `apps/web/src/index.css`) with a responsive 4-tab bottom navigation bar on phones and an adaptive navigation rail on tablets and foldables.
- **Native Android Edge-to-Edge Shell**: Updated `MainActivity.java` with Android window insets integration (`WindowCompat.setDecorFitsSystemWindows`), hardware-accelerated rendering, native haptic feedback (`performHapticFeedback`), and explicit status/navigation bar styling.
- **Interactive Mobile Wi-Fi Spectrum Chart**: Added touch-scrubbing channel inspection and live BSSID congestion filtering on mobile viewports (`apps/web/src/components/telemetry/WifiAnalyzer.tsx`).

### Changed
- **Repository & Documentation Cleanup**: Removed redundant documentation files, standardized release naming (`AI NetController v0.xx.x`), and updated setup and build guides.
- **Mobile Touch Ergonomics**: Removed hover-dependent tooltips on touch devices, replaced desktop window chrome with a compact mobile header, and converted modals into bottom sheets on mobile screens.

---

## [v0.31.3] - 2026-04-05

### Added
- **Persistent Onboarding State**: Saved onboarding completion state across sessions so returning users go straight to the telemetry dashboard.
- **High-Contrast Telemetry Palette**: Improved chart legibility and status badge contrast across dark and OLED themes.

### Fixed
- Fixed version string mismatches across the release manifest and mobile build scripts.

---

## [v0.31.2] - 2026-04-04

### Added
- **Responsive Viewport Scaling**: Added fluid typography and responsive container sizing from 320px mobile screens up to 4K desktop monitors.
- **Android Hardware Back Navigation**: Wired Android system back gestures (`OnBackPressedCallback`) to close active drawers and modals before exiting the app.

### Fixed
- Fixed horizontal overflow issues in the packet capture table on narrow viewports.

---

## [v0.31.1] - 2026-04-02

### Added
- **Automated Release Packaging**: Added `scripts/build_release_binaries.py` and `scripts/build_android_app.py` for reproducible Windows `.exe`, portable `.zip`, and signed Android `.apk` builds with SHA-256 checksum generation.
- **Unified Branding**: Standardized application naming to **AI NetController** across Windows executables, Android manifests, and WebSocket handshakes.

### Changed
- Reorganized repository layout into `agent/`, `apps/web/`, `apps/mobile/`, `docs/`, `scripts/`, and `tests/`.

---

## [v0.30.0] - 2026-03-29

### Added
- **Native Android WebView Bridge**: Replaced external browser redirects with an embedded `AndroidBridge` JavaScript interface supporting native LAN ping checks and device info queries.
- **Local LLM Provider Support**: Added native Ollama (`http://localhost:11434`) integration alongside Gemini, OpenAI, and Anthropic API adapters.

### Fixed
- Fixed WebSocket reconnection backoff when switching between Wi-Fi networks on Android.

---

## [v0.29.0] - 2026-03-25

### Added
- **Zero-Data-Loss Telemetry Buffer**: Added an SQLite-backed ring buffer (`agent/core/offline_buffer.py`) in the Windows Host Agent to cache metrics while disconnected from the server.
- **mDNS & Subnet Auto-Discovery**: Added automatic LAN host discovery (`_ainetcontroller._tcp.local.`) for zero-configuration pairing between the desktop agent and mobile app.

### Security
- Added HMAC-SHA256 payload verification and rate limiting on `/api/*` endpoints.

---

## [v0.28.0] - 2026-03-24

### Added
- **802.11ax/be Channel Congestion Engine**: Added 2.4 GHz, 5 GHz, and 6 GHz channel overlap calculation and BSSID signal-to-noise ratio telemetry (`agent/core/wifi_scanner.py`).
- **Wireshark-Style Packet Flow Graph**: Added interactive TCP/UDP sequence diagrams and `.pcap` export (`apps/web/src/components/telemetry/FlowGraph.tsx`).

---

## [v0.27.1] - 2026-03-23

### Fixed
- **Windows High-DPI Scaling**: Enabled Per-Monitor V2 DPI awareness in the Windows Host Agent wrapper so native dialogs render crisply on 125%–200% displays.
- **Privilege Fallback**: Fixed crash when starting `net_agent.py` without Administrator privileges; the agent now degrades cleanly to read-only monitoring.

---

## [v0.27.0] - 2026-03-22

### Added
- Initial beta release of **AI NetController**.
- Real-time bandwidth, latency, and per-process socket telemetry via `psutil` and `scapy`.
- Windows QoS DSCP tagging and `netsh` TCP parameter optimization profiles.
- Express + WebSocket control server and React telemetry dashboard.

# AI NetController v0.32.0 — Release Notes

**AI NetController v0.32.0** overhauls the mobile application experience with a native Android layout, hardware-accelerated telemetry rendering, and streamlined documentation across the repository.

---

## What's New in v0.32.0

### Mobile App Overhaul
- **Adaptive Navigation**: Dedicated 4-tab bottom navigation bar on phones and an automatic side navigation rail on tablets, foldables, and landscape viewports.
- **Native Android Integration**: True edge-to-edge rendering with Android system bar inset handling, native touch haptics via `AndroidBridge.vibrate()`, and hardware back-button navigation for drawers and sheets.
- **Touch-First Telemetry Controls**: Redesigned the Wi-Fi spectrum analyzer, packet capture inspector, and QoS profile selector for one-handed mobile operation without horizontal scrolling or hover-only tooltips.
- **Smooth Frame Pacing**: Scoped CSS transitions and GPU-composited animations (`transform`, `opacity`) for jitter-free scrolling on 60 Hz and 120 Hz mobile displays.

### Documentation & Repository Cleanup
- Removed redundant documentation files and standardized all release notes and changelogs around the `v0.xx.x` beta versioning scheme.
- Updated `docs/SETUP_GUIDE.md` and `docs/COMPILATION_GUIDE.md` with clear, step-by-step instructions for Windows, Linux, and Android builds.

---

## Release Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.32.0_win64.exe` | Windows x64 | Standalone Windows Host Agent executable |
| `AI_NetController_HostAgent_v0.32.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent and checksums |
| `AI_NetController_v0.32.0_arm64-v8a.apk` | Android ARM64 | Signed Android package optimized for `arm64-v8a` devices |
| `AI_NetController_v0.32.0.apk` | Android Universal | Universal Android installation package |
| `RELEASE_MANIFEST.json` | All | Build metadata and asset manifest |
| `SHA256SUMS.txt` | All | SHA-256 checksums for all release binaries |

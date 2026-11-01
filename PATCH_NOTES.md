# CST NetController AI — v3.1.0-beta.1 Release Notes

[![Version](https://img.shields.io/badge/version-v3.1.0--beta.1-blue.svg)](https://github.com/smehmedd/AI-NetController/releases/tag/v3.1.0-beta.1)
[![Channel](https://img.shields.io/badge/channel-public%20beta-amber.svg)](https://github.com/smehmedd/AI-NetController/releases)
[![Tests](https://img.shields.io/badge/tests-116%20passed%2C%200%20failed-brightgreen.svg)](https://github.com/smehmedd/AI-NetController)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

- **Release Version**: `v3.1.0-beta.1`
- **Release Channel**: Public Beta
- **Release Date**: November 1, 2026
- **Protocol**: `CST/3.0-SECURE`
- **Compatibility**: Windows 10 / 11 x64, Linux (kernel 5.15+), Android 7.0–15

---

## Summary

The `v3.1.0-beta.1` release introduces targeted performance optimizations for the Android native container, eliminates layout overflow on narrow mobile screens, refines visual contrast across all primary dashboards, and transitions all current releases to the public beta channel.

---

## 1. Android Native Container & Display Pipeline

- **Direct Hardware Compositing**:
  - Removed `webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)` to eliminate redundant full-screen offscreen OpenGL frame-buffer double-blitting.
  - Enabled Chromium's internal direct tile rasterization into SurfaceFlinger, allowing fluid frame delivery at up to 144Hz.
- **Viewport & Resolution Calibration**:
  - Enabled `setUseWideViewPort(true)` and `setLoadWithOverviewMode(true)` so the HTML5 viewport (`width=device-width, initial-scale=1.0, viewport-fit=cover`) scales 1:1 on mobile screens without zooming out or letterboxing.
  - Configured `setOverScrollMode(OVER_SCROLL_IF_CONTENT_SCROLLS)` for standard native scroll physics.
- **Safe-Area Integration**:
  - Preserved native `WindowInsets.Type.systemBars()` and `displayCutout()` listener to protect top app bars, bottom navigation, and modal drawers from notch or gesture bar overlap.

---

## 2. Multi-Resolution Layout Containment & Bug Fixes

- **Fleet Dashboard Onboarding Containment**:
  - Resolved an issue where unconstrained button text in the initial onboarding banner pushed the container width to 555px (+144px beyond the 411px viewport).
  - Added responsive wrapping (`flex-wrap gap-2`), `min-w-0`, and text clamping (`line-clamp-2`).
- **Zero-Overflow Layout Verification**:
  - Audited all 4 primary application tabs on a live Android emulator (`1080×2400 @ 420dpi`, `411×914dp` viewport):
    - **Fleet Tab**: `scrollWidth: 411px`, `windowWidth: 411px`, `unclippedCount: 0`
    - **Terminal Tab**: `scrollWidth: 411px`, `windowWidth: 411px`, `unclippedCount: 0`
    - **Chat Tab**: `scrollWidth: 411px`, `windowWidth: 411px`, `unclippedCount: 0`
    - **Settings Tab**: `scrollWidth: 411px`, `windowWidth: 411px`, `unclippedCount: 0`
  - Horizontal page scrolling is completely prevented on all tested mobile resolutions.

---

## 3. Visual Polish & Contrast Enhancements

- **Shader Performance**:
  - Reduced CSS backdrop blur radii from `28px`/`44px` to GPU-efficient `14px`–`24px` while increasing saturation (`saturate(210% - 230%)`) to maintain high contrast without frame drops during rapid scrolling.
  - Refined top specular borders (`rgba(0, 240, 255, 0.48 - 0.65)`) for clean visual definition.
- **Telemetry & Micro-Interactions**:
  - Compacted header action buttons on `HostCard` to `min-w-[38px] min-h-[38px]` on mobile, preventing awkward column wrapping next to host titles.
  - Increased depth and saturation of CPU and RAM telemetry bars with high-contrast gradient fills and ambient glowing highlights.
  - Standardized `.scrollbar-none` and `.no-scrollbar` utility classes with momentum touch scrolling.

---

## 4. Release Channel Realignment

All current GitHub releases have been transitioned to the **Public Beta** channel:
- `v3.1.0-beta.1` (Current Public Beta)
- `v3.0.0` (Beta)
- `v2.9.0` (Beta)
- `v2.8.0` (Beta)
- `v2.7.1` (Beta)
- `v2.7.0` (Beta)

Users are encouraged to test across varying hardware setups and report issues via GitHub Issues.

---

## 5. Verification & Test Coverage

All test suites passed with zero errors prior to release:

| Test Suite | Result | Details |
| :--- | :---: | :--- |
| **`npm run lint`** | **PASS** | 0 TypeScript or ESLint errors |
| **`npm test`** | **PASS (63/63)** | 40/40 Core Architectural Pillars + 23/23 Stress Benchmarks |
| **`agent/tests`** | **PASS (53/53)** | 53 unit tests in 3.95s (Chaos Shield, Sandbox, File Transfer) |
| **Android APK Build** | **PASS** | 1.31 MB signed package (`f470a50b...`) |
| **DevTools Protocol Audit** | **PASS** | 0 unclipped overflow elements across all tabs on Android 14/15 |

---

## 6. Official Binaries & Checksums

| Artifact | Target Platform | File Size | Direct Download |
| :--- | :--- | :---: | :---: |
| **`CST_HostAgent_v3.1.0_win64.exe`** | Windows 10 / 11 x64 | 35.3 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/CST_HostAgent_v3.1.0_win64.exe) |
| **`CST_HostAgent_v3.1.0_win64_portable.zip`** | Windows 10 / 11 x64 (Portable) | 35.0 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/CST_HostAgent_v3.1.0_win64_portable.zip) |
| **`CST_NetController_AI_v3.1.0_arm64-v8a.apk`** | Android 7.0–15 (`arm64-v8a`) | 1.31 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/CST_NetController_AI_v3.1.0_arm64-v8a.apk) |
| **`CST_NetController_AI_v3.1.0.apk`** | Android 7.0–15 (Universal) | 1.31 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/CST_NetController_AI_v3.1.0.apk) |
| **`SHA256SUMS.txt`** | Checksums | 413 B | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/SHA256SUMS.txt) |
| **`RELEASE_MANIFEST.json`** | Metadata Manifest | 1.9 KB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/RELEASE_MANIFEST.json) |

```text
6e90065c056934ca4aa6f81ba25d50654ea22c34d3bb07cf7c938d617c06eb46  CST_HostAgent_v3.1.0_win64.exe
5db218345f47a2aa488db9f18b33535d55b850422c5e5db5d2a33ebbf6e85579  CST_HostAgent_v3.1.0_win64_portable.zip
f470a50bd4e0202597f4e3d2a0725077dd0d35d10338c347796d503169732117  CST_NetController_AI_v3.1.0_arm64-v8a.apk
f470a50bd4e0202597f4e3d2a0725077dd0d35d10338c347796d503169732117  CST_NetController_AI_v3.1.0.apk
```

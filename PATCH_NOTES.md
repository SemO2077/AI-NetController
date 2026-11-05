# CST NetController AI — v3.1.0-beta.2 Release Notes

[![Version](https://img.shields.io/badge/version-v3.1.0--beta.2-blue.svg)](https://github.com/smehmedd/AI-NetController/releases/tag/v3.1.0-beta.2)
[![Channel](https://img.shields.io/badge/channel-public%20beta-amber.svg)](https://github.com/smehmedd/AI-NetController/releases)
[![Tests](https://img.shields.io/badge/tests-116%20passed%2C%200%20failed-brightgreen.svg)](https://github.com/smehmedd/AI-NetController)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

- **Release Version**: `v3.1.0-beta.2`
- **Release Channel**: Public Beta
- **Release Date**: November 5, 2026
- **Protocol**: `CST/3.0-SECURE`
- **Compatibility**: Windows 10 / 11 x64, Linux (kernel 5.15+), Android 7.0–15

---

## Summary

The `v3.1.0-beta.2` release brings comprehensive mobile ergonomics and visual refinement to the Android native application. Every core view has undergone line-by-line inspection to eliminate all tiny font sizes (< 10px), enforce mobile touch target standards (>= 36px–42px), and enhance the cyber-neon glass aesthetic with rich contrast and luminous accents.

---

## 1. Deep Ergonomics & Touch Target Enlargement

- **Navigation & Telemetry Controls**:
  - The live network telemetry and simulation lab toggle in `FloatingPillNav` has been elevated to `min-h-[38px] px-3.5` with rounded touch padding.
  - Header shortcut buttons (`⌘K`, `?`) in `FleetDashboard` upgraded to `min-h-[32px] px-2.5` touch capsules.
  - Segmented Cards/Topology toggle buttons now strictly maintain `min-w-[36px] min-h-[36px]` in icon-only mobile mode.
- **AI PC Control Deck & Chat**:
  - Expanded all AI quick control action pills in `GeminiChatbot` to `min-h-[38px] px-3.5 py-2`, offering comfortable thumb tapping without misclicks.
  - Inline code snippet copy buttons enlarged to `min-h-[32px] px-2`.
- **Modals & Utilities**:
  - Language toggle switches (`LanguageToggle`) upgraded from 24px height to `min-h-[38px] px-4 py-2`.
  - `OnboardingModal` close button expanded to `40×40px`, language pills to `min-h-[38px]`, carousel indicator step dots wrapped in `32×32px` touch areas, and primary action buttons (`Напред`, `Сдвояване`, `Към Конзолата`) to `min-h-[42px] px-5`.
  - Reset, expand/collapse, and history filter buttons in `WolEnergyCalculator` and `WolHistoryLogViewer` boosted to `min-h-[36px]`.

---

## 2. Complete Elimination of Sub-10px Fonts & Fluid Typography

- **Fluid Mobile Media Queries**:
  - Standardized `:root` minimum font size to `14px` on ultra-narrow foldables (`<= 320px`) and `14.5px` on compact mobile (`321px–374px`). Rem-based `text-xs` typography now reliably computes to `>= 10.5px`.
  - Fluid caption utility `.text-fluid-meta` calibrated to `clamp(0.75rem, 0.72rem + 0.16vw, 0.84rem)`.
- **Sub-10px Codebase Elimination**:
  - Replaced all legacy `text-[8px]`, `text-[8.5px]`, `text-[9px]`, and `text-[9.5px]` classes across all components (`HostCard`, `FleetDashboard`, `FloatingPillNav`, `OnboardingModal`, `HeartbeatSparkline`, `HostLatencySparkline`, `ScreenViewerModal`, `WolEnergyWeeklyChart`).
  - Terminal stream previews and system tags render crisply with high legibility on any mobile screen.

---

## 3. Cyber-Neon Visual Polish & 144Hz Frame Budget

- Specular cyan glass borders (`rgba(0, 240, 255, 0.48–0.65)`) with multi-layer ambient glows.
- Enhanced telemetry bars (CPU, RAM, RTT) with rich saturation and glow filters.
- Zero-jitter GPU layer acceleration (`transform: translate3d(0, 0, 0)`) maintaining 144Hz fluidity with zero reflows.

---

## 4. Automated Chrome DevTools Protocol (CDP) Deep Audit

Audited across 12 combinations (320px, 360px, 411px viewports across Fleet, Terminal, Chat, and Settings tabs):

| Metric | Target | Result | Status |
|---|:---:|:---:|:---:|
| **Viewport Leaks (Offscreen Elements)** | 0 | **0** | **PASS** |
| **Horizontal Text Overflow** | 0 | **0** | **PASS** |
| **Sub-10px Tiny Text** | 0 | **0** | **PASS** |
| **Small Tap Targets on Core Views** | 0 | **0** | **PASS** |
| **Page Horizontal Scroll** | Exact Viewport Width | `scrollWidth === innerWidth` | **PASS** |

---

## 5. Verification & Test Coverage

All test suites passed with zero errors prior to release:

| Test Suite | Result | Details |
| :--- | :---: | :--- |
| **`npm run lint`** | **PASS** | 0 TypeScript or ESLint errors (`tsc --noEmit`) |
| **`npm test`** | **PASS (63/63)** | 40/40 Core Architectural Pillars + 23/23 Stress Benchmarks |
| **`agent/tests`** | **PASS (53/53)** | 53 unit tests in 4.12s (Chaos Shield, Sandbox, File Transfer) |
| **Android APK Build** | **PASS** | 1.31 MB signed package (`e8f9f5e8...`) |
| **CDP Deep Visual Audit** | **PASS** | 0 leaks, 0 overflows, 0 tiny text across all tested mobile viewports |

---

## 6. Official Binaries & Checksums

| Artifact | Target Platform | File Size | Direct Download |
| :--- | :--- | :---: | :---: |
| **`CST_HostAgent_v3.1.0_win64.exe`** | Windows 10 / 11 x64 | 35.3 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_HostAgent_v3.1.0_win64.exe) |
| **`CST_HostAgent_v3.1.0_win64_portable.zip`** | Windows 10 / 11 x64 (Portable) | 35.0 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_HostAgent_v3.1.0_win64_portable.zip) |
| **`CST_NetController_AI_v3.1.0_arm64-v8a.apk`** | Android 7.0–15 (`arm64-v8a`) | 1.31 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_NetController_AI_v3.1.0_arm64-v8a.apk) |
| **`CST_NetController_AI_v3.1.0.apk`** | Android 7.0–15 (Universal) | 1.31 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_NetController_AI_v3.1.0.apk) |
| **`SHA256SUMS.txt`** | Checksums | 413 B | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/SHA256SUMS.txt) |
| **`RELEASE_MANIFEST.json`** | Metadata Manifest | 1.9 KB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/RELEASE_MANIFEST.json) |

```text
6e90065c056934ca777452bcba97bfcf50e27cd333709cf69d0033cd2cbd4969  CST_HostAgent_v3.1.0_win64.exe
5db218345f47a2aa746d8e9aaf9fb6c20643543bddaef8a04816b581b3c4f348  CST_HostAgent_v3.1.0_win64_portable.zip
e8f9f5e818b93a5f9b4fdb71028fff1fcb29b6c8f58c684b0208d491f5d7e0e3  CST_NetController_AI_v3.1.0_arm64-v8a.apk
e8f9f5e818b93a5f9b4fdb71028fff1fcb29b6c8f58c684b0208d491f5d7e0e3  CST_NetController_AI_v3.1.0.apk
```

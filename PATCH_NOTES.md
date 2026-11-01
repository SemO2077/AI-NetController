# CST NetController AI — v3.0.0 (Updated 3.0) Major Release Notes

[![Version](https://img.shields.io/badge/version-v3.0.0--(Updated%203.0)-blue.svg)](https://github.com/smehmedd/AI-NetController/releases/tag/v3.0.0)
[![Authenticode](https://img.shields.io/badge/code--signing-O%3DCST__RU--AK-brightgreen.svg)](https://github.com/smehmedd/AI-NetController)
[![Windows Defender](https://img.shields.io/badge/windows--defender-clean%20(0%20threats)-success.svg)](https://github.com/smehmedd/AI-NetController)
[![Test Suite](https://img.shields.io/badge/tests-116%2F116%20passing-brightgreen.svg)](https://github.com/smehmedd/AI-NetController)
[![Display](https://img.shields.io/badge/display-144Hz%20Zero--Jitter-9cf.svg)](https://github.com/smehmedd/AI-NetController)

> **Release Version:** `v3.0.0-LTS (Updated 3.0)` (Full-Stack Project Overhaul: True Native Android Controller Engine, 1:1 Mobile Viewport & WindowInsets Safe-Area Engine, Multi-Threaded `/24` LAN Subnet Scanner, Directed Broadcast UDP Wake-on-LAN, Zero-Overflow Multi-Resolution UI, and Complete WebSocket/HITL/Auth Protocol Parity)  
> **Protocol Specification:** `CST/3.0-SECURE`  
> **Release Date:** November 1, 2026  
> **Previous Releases:** [`v2.9.0`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.9.0), [`v2.8.0`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.8.0), [`v2.7.1`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.7.1), and [`v2.7.0`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.7.0) (All remain fully accessible in the Releases tab)

---

## 📦 Official Release Binaries (v3.0.0 — Updated 3.0)

All binaries are pre-compiled, cryptographically signed (`O=CST_RU-AK` / Android APK Signature Schemes v2+v3), and verified clean (`0 threats found`).

| File / Artifact | Target Platform | Size | Direct Download |
| :--- | :--- | :---: | :---: |
| **`CST_HostAgent_v3.0.0_win64.exe`** | Windows 10 / 11 (`x86_64` PE32+ GUI) | 35.3 MB | [Download EXE](https://github.com/smehmedd/AI-NetController/releases/download/v3.0.0/CST_HostAgent_v3.0.0_win64.exe) |
| **`CST_HostAgent_v3.0.0_win64_portable.zip`** | Windows 10 / 11 (`x86_64` Portable Bundle) | 35.0 MB | [Download Portable ZIP](https://github.com/smehmedd/AI-NetController/releases/download/v3.0.0/CST_HostAgent_v3.0.0_win64_portable.zip) |
| **`CST_NetController_AI_v3.0.0_arm64-v8a.apk`** | Android 7.0 – 15 (`arm64-v8a` Native 144Hz Controller) | 1.31 MB | [Download APK (arm64-v8a)](https://github.com/smehmedd/AI-NetController/releases/download/v3.0.0/CST_NetController_AI_v3.0.0_arm64-v8a.apk) |
| **`CST_NetController_AI_v3.0.0.apk`** | Android 7.0 – 15 (Universal Package) | 1.31 MB | [Download APK (Universal)](https://github.com/smehmedd/AI-NetController/releases/download/v3.0.0/CST_NetController_AI_v3.0.0.apk) |
| **`SHA256SUMS.txt`** | Checksum Verification List | 413 B | [Download SHA256](https://github.com/smehmedd/AI-NetController/releases/download/v3.0.0/SHA256SUMS.txt) |
| **`RELEASE_MANIFEST.json`** | Structured Metadata Manifest | 1.9 KB | [Download Manifest](https://github.com/smehmedd/AI-NetController/releases/download/v3.0.0/RELEASE_MANIFEST.json) |

<details>
<summary><b>🔒 Cryptographic SHA-256 Checksums (Click to expand)</b></summary>

```text
ab33d3b4ea79e0bf89483221cfdba9dd86ffb29893d18a773f28ffde4aab09b3  CST_HostAgent_v3.0.0_win64.exe
a24be6fae2c575e1862e977f52fc0bfb8a71b35cf5a1462bbf5b071c3b14b700  CST_HostAgent_v3.0.0_win64_portable.zip
539fa8d7790e2e05fcf0f0d467cbac7a1a6f1eed2da12e2344ff08c644809830  CST_NetController_AI_v3.0.0_arm64-v8a.apk
539fa8d7790e2e05fcf0f0d467cbac7a1a6f1eed2da12e2344ff08c644809830  CST_NetController_AI_v3.0.0.apk
```
</details>

---

## 🚀 Key Major Fixes & Architectural Upgrades in Updated 3.0

### 1. True Native Android Application Overhaul (`MainActivity.java`)
- **1:1 Native Mobile Viewport Scaling**: Disabled `setUseWideViewPort(true)` and `setLoadWithOverviewMode(true)` in Android `WebSettings` so 1 CSS pixel equals 1 Android `dp` (`360px`–`430px` on phones), eliminating the zoomed-out 980px desktop layout on mobile screens.
- **Hardware `WindowInsets` Safe-Area Engine**: Attached a native `View.OnApplyWindowInsetsListener` to the root container handling `WindowInsets.Type.systemBars()`, `displayCutout()`, and `ime()` (soft keyboard). Status bars, camera hole-punches/notches, gesture navigation bars, and the soft keyboard never overlap or clip any UI controls.
- **Multi-Threaded `/24` LAN Subnet Discovery (`/api/hosts/scan`)**: Replaced `/proc/net/arp`-only scanning (blocked by SELinux on Android 10–15) with a 32-thread native Java subnet scanner probing ports `8765` (CST Host Agent), `3000` (CST Web Console), `445`/`135` (Windows SMB/RPC), and `22` (SSH), enriched with `ip neigh show` and automatic `/api/setup/info` metadata discovery.
- **Directed Subnet Broadcast & SecureOn UDP Wake-on-LAN (`sendNativeWol`)**: Upgraded the native Java `DatagramSocket` engine to support both 102-byte standard and 108-byte SecureOn Magic Packets, broadcasting simultaneously to `InterfaceAddress.getBroadcast()` on active Wi-Fi interfaces and `255.255.255.255` (UDP ports 9 & 7).
- **Complete Local HTTP Server & API Parity**: Implemented full `Content-Length` HTTP request body reading and complete native endpoints for `/api/setup/info`, `/api/releases`, `/api/update/status`, `/api/update/check`, `/api/update/execute`, `/api/update/ai-analyze`, `/api/daemon/state`, `/api/daemon/action`, `/api/ai/models`, `/api/ai/models/test`, `/api/pc-control/execute`, and context-aware `[ACTION:...]` responses in `/api/chat`.
- **Native Clipboard & Download Bridge**: Added `AndroidBridge.copyToClipboard()` using Android `ClipboardManager` and external `DownloadListener` intent handling.

### 2. Zero Visual Overflow & Multi-Resolution UI Fixes
- **Tailwind v4 `@theme` `xs:` Breakpoint (`400px`)**: Added `@theme { --breakpoint-xs: 400px; }` in `index.css` so all responsive `xs:` utilities activate properly across compact Android phones.
- **Mobile `HostCard` Header Layout**: Prevented the 4 right-side action buttons from crushing the hostname/IP column on 360px–390px screens, and added full Edit Host & Remove Host support.
- **Smooth Touch Scrolling Inside `BottomSheet` Modals**: Restricted sheet drag-to-dismiss to the top drag handle and header via `useDragControls()`, allowing vertical touch scrolling inside `HostDetailsModal` and `MemoryManager` without accidentally dragging the modal closed.
- **Fixed `MemoryManager` Crash**: Imported missing `useEffect` in `MemoryManager.tsx` so opening System Rules & Contextual Memory never throws a `ReferenceError`.
- **Fixed `OnboardingModal`, `CommandTerminal`, `FloatingPillNav` & `WolModal`**:
  - Fixed `OnboardingModal` animation variant names (`initial="initial" animate="animate"`) and responsive step-5 footer wrapping on `<400px` screens.
  - Fixed `CommandTerminal` horizontal `<pre>` overflow (`break-words overflow-x-auto max-w-full`) and deduplicated rapid sub-second command executions using `command_id`.
  - Fixed `FloatingPillNav` active tab width (`flex-[1.5] sm:flex-1`) and hid false latency numbers when disconnected.
  - Restored default sample schedules (`TEST_WOL_SCHEDULES`) and added custom MAC schedule support in `WolModal`.

### 3. Full-Stack Agent, Server & WebSocket Worker Protocol Fixes
- **Unified Authentication & JSON/Binary Command Routing (`agent/agent.py`, `agent/agent_gui.py`)**:
  - Synchronized shared secrets and GUI pairing PIN/tokens across binary `OP_AUTH` (`0x06`) and JSON `AUTHENTICATE`.
  - Added full JSON frame handling for `EXECUTE_PROMPT`, `APPROVAL_RESPONSE`, `PANIC_KILL_ALL`, `INPUT_EVENT` / `PC_CONTROL`, and `CLIPBOARD_SYNC`.
  - Unified `APPROVAL_REQUIRED` and `EXECUTION_RESULT` payloads with `command_id`, `approval_id`, `proposed_command`, `exit_code`, and `timestamp`.
- **Pure-JS SHA-256 & HMAC-SHA256 WebSocket Auth Fallback (`networkWorker.ts`)**:
  - Added pure-JS SHA-256 and HMAC-SHA256 so binary `OP_AUTH` challenge-response works on non-HTTPS LAN origins (`http://192.168.1.x:3000`) where `crypto.subtle` is unavailable.
  - Fixed `parseBinaryFrame` sequence number handling so `OP_HITL` (`0x05`) does not cause the subsequent `OP_SHELL` (`0x04`) result packet with the same request sequence number to be dropped as a replay.
- **Fixed `GET /api/releases` Server Route (`apps/web/server.ts`)**: Fixed `ReferenceError: v290Path is not defined` and prioritized `v3.0.0` release manifest resolution.

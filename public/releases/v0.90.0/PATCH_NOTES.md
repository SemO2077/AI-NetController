# AI NetController Beta 0.90.00 (`v0.90.0`) — Patch Notes

**AI NetController Beta 0.90.00 (`v0.90.0`)** is a major streaming latency, mobile UX, and fleet operations update delivering **ultra-low-latency 60 FPS hardware screen sharing** with credit-based **`OP_FRAME_ACK` (`0x0E`)** flow control, **Direct Win32 `SendInput` & coalesced 60Hz binary touch injection**, **background Dart `Isolate` AEAD frame decryption**, **Direct Touchscreen & Immersive Landscape Fullscreen** control, **Expandable Fleet PC Cards with Live Screen Preview**, a ground-up **Command-Deck Settings Hub** featuring a dedicated **Wake-on-LAN Hub** and **Unified Activity & Audit History Center**, **zero-config `CST_DISCOVER_V1` LAN UDP discovery**, and **Flutter 3.50 / AGP 9.3.1 Built-in Kotlin** build hardening.

---

## What's New & Changed in Update `0.90.00` (`v0.90.0`)

### 1. Ultra-Low-Latency 60 FPS Screen Sharing & Input Pipeline (`agent/`, `apps/mobile/`)
- **Zero-Copy Strided `BGRX` Capture & Dynamic `TurboJPEG` Loader (`agent/agent.py`, `agent/multi_monitor_streamer.py`)**:
  - Added optional Windows DXGI Desktop Duplication (`dxcam` / `bettercam`) with seamless fallback to thread-local `mss`.
  - Replaced full-frame 1080p/4K `.copy()` and intermediate 3-channel RGB slice conversions with a preallocated `(out_h, out_w, 4)` buffer and direct `TurboJPEG.encode(..., pixel_format=TJPF_BGRX, jpeg_subsample=TJSAMP_420, flags=TJFLAG_FASTDCT)`.
  - Added automatic `libturbojpeg` DLL/shared-library discovery (`_discover_turbojpeg`) across Windows (`C:\libjpeg-turbo64\bin`, bundled PyInstaller paths, Conda/winget paths), Linux, and macOS.
  - Added reusable `_work_bgra` cursor blending buffers and progressive static-frame backoff (`16ms -> 40ms -> 80ms -> 160ms` max vs. previous `450ms`) for instantaneous visual wake-up on screen changes.
- **Credit-Based `OP_FRAME_ACK` (`0x0E`) Flow Control & Off-Loop AEAD Encryption**:
  - Replaced single-frame stop-and-wait pauses with a 2-frame sliding credit window (`max_in_flight = 2`), 9-byte `OP_FRAME_ACK` (`uint8 sub_type=1`, `uint32be frame_seq`, `uint32be decode_time_us`), `350ms` stall auto-recovery, and a `128 KiB` socket write-buffer ceiling (`transport.get_write_buffer_size()`) to prevent TCP bufferbloat.
  - Offloaded ChaCha20-Poly1305 AEAD frame encryption (`OP_FRAME >= 16 KiB`) onto a dedicated single-thread `CryptoTx` executor so asyncio socket reads and mouse/keyboard events never stall behind video encryption.
- **Direct Win32 `SendInput` & Coalesced 60Hz Pointer Moves (`InputInject` in `agent/agent.py`)**:
  - Bypassed `pyautogui`'s 100ms per-call sleep overhead on Windows using direct `ctypes.windll.user32.SendInput` with `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` (`0..65535` normalized coordinates across single and virtual multi-monitor desktops) and Unicode/Virtual-Key scancode injection.
  - Added a non-blocking latest-move coalescing queue for binary pointer moves (`event_type == 4`) so high-rate touchscreen drags never queue behind older move packets.
- **Mobile Background Decrypt Isolate & Immediate Frame Ack (`apps/mobile/lib/services/frame_decrypt_isolate.dart`, `host_connection_client.dart`, `zero_gc_video_pipeline.dart`)**:
  - Offloaded `CST_ECDH_V2` ChaCha20-Poly1305 decryption and `PacketReassembler` chunk reassembly for `OP_FRAME` packets onto a persistent Dart background `Isolate` (`FrameDecryptIsolate`) using zero-copy `TransferableTypedData`.
  - Eliminated WebSocket stream pause/resume stalls on video frames and wired `ZeroGcVideoPipeline` to emit `OP_FRAME_ACK` (`0x0E`) + `OP_FRAME_SYNC` (`0xED`) immediately upon `ui.instantiateImageCodec` GPU frame decode completion.
  - Increased mobile binary touch move dispatch rate to `60Hz` (`16ms` interval) with immediate flush on pointer-up and tap events.

### 2. Direct Touchscreen Control, Immersive Fullscreen & Remote Keyboard Bar (`apps/mobile/`)
- **Direct Touchscreen vs. Trackpad Dual Input Modes (`apps/mobile/lib/ui/touch_coordinate_mapper.dart`, `touch_feedback_overlay.dart`, `viewport_stream_widget.dart`)**:
  - **Direct Touchscreen Mode**: Absolute coordinate mapping onto the remote desktop aspect ratio with smooth pinch-to-zoom (`1.0x`–`4.0x`), 2-finger pan, single-tap left click, long-press right click (with animated radial hold ring), double-tap, 1-finger drag, and 2-finger vertical/horizontal wheel scrolling.
  - **Precision Trackpad Mode**: Relative cursor movement with configurable trackpad sensitivity (`0.5x`–`3.0x`), natural scroll toggle, and reduced-motion accessibility compliance.
  - Wrapped passive connection status overlays in `IgnorePointer` so touch gestures remain responsive before and during stream initialization.
- **Immersive Landscape Fullscreen & Translucent Floating HUD (`apps/mobile/lib/ui/fullscreen_stream_page.dart`, `remote_keyboard_bar.dart`)**:
  - Dedicated `FullscreenStreamPage` with edge-to-edge `SystemUiMode.immersiveSticky`, auto-collapsing translucent HUD pill (live FPS, RTT latency, AEAD lock badge, 1-tap `Input Mode` toggle, `Monitor` switcher, `Reset Zoom`, and `Keyboard` drawer trigger).
  - Slide-up **Remote Keyboard & Macro Bar** (`RemoteKeyboardBar`) supporting sticky modifier latches (`Ctrl`, `Alt`, `Shift`, `Win`), special keys (`Esc`, `Tab`, `Del`, `Home`, `End`, `PgUp`, `PgDn`, `F1`–`F12`), arrow cluster, and 1-tap system macros (`Ctrl+C`, `Ctrl+V`, `Ctrl+Z`, `Alt+Tab`, `Win+D`, `Ctrl+Shift+Esc`).

### 3. Expandable Home Screen PC Cards with Live Screen Preview (`apps/mobile/lib/ui/responsive_device_card.dart`, `host_snapshot_preview.dart`, `main.dart`)
- **Single-Accordion Inline Card Expansion**:
  - Tapping a workstation card or its chevron on the Fleet Home screen expands it inline with smooth `AnimatedSize` spring physics (`240ms`, `Curves.easeOutCubic`), keeping the collapsed card clean (status dot, hostname, OS icon, IP/latency pill, CPU/RAM mini-gauges, and primary action button).
- **Live 16:9 Screen Snapshot Preview (`HostSnapshotPreview`)**:
  - Automatically requests lightweight encrypted `OP_VIEWPORT_RESIZE` (`480x270`, `quality: 55`, `"snapshot": true`) frames every 5 seconds while expanded, displaying the live desktop thumbnail with a `"Updated Xs ago"` pill, manual refresh button, and 1-tap launch directly into `FullscreenStreamPage`.
  - Gracefully renders a `"Host Offline — Tap Wake (WoL) to Power On"` placeholder with 1-tap Wake-on-LAN dispatch when the host is sleeping or offline.
- **Expanded Telemetry Grid & Quick Action Bar**:
  - Displays detailed **CPU & RAM Load Bars**, **IP:Port Endpoint**, **MAC Address** (or `CST_ECDH_V2` security status), **OS / Monitor count**, and **RTT Ping**, plus 1-tap pills for **Touch Control**, **Fullscreen**, **Terminal**, **Wake (WoL)**, **Diagnostics**, and **Pair / Disconnect**.

### 4. Ground-Up Settings Command-Deck Redesign, WoL Hub & Activity History Center (`apps/mobile/lib/ui/settings_command_deck.dart`, `wol_hub_panel.dart`, `activity_history_panel.dart`, `services/history_store.dart`)
- **Command-Deck Control Hub Architecture**:
  - Rebuilt the mobile Settings tab from the ground up with a live fleet status banner, instant cross-setting search bar (`100ms` debounce filtering across titles, subtitles, and keywords), 5 horizontal category jump pills (`Quick Ops`, `Remote & Stream`, `Security & AI`, `Appearance`, `System & Backup`), `"Modified"` badges on non-default settings, and per-section **Reset to Defaults**.
  - Positioned **Appearance Studio** (Daylight/Dark polarity toggle, 6 accent color swatches, glass intensity slider, and live mini preview card) in **Section 4 of 5** (lower half) so daily operational hubs and remote streaming controls take priority at the top.
- **Dedicated Wake-on-LAN (WoL) Hub (`WolHubPanel`)**:
  - Placed in `Section 1: Quick Operations` with a saved host quick-picker, custom target form (`MAC Address` with live hex validation, `Broadcast IP`, `UDP Port 9 / 7`), **Send Magic Packet** and **Wake All Fleet** actions, and a persistent **Recent WoL Dispatches** log with 1-tap **Re-Send**.
- **Unified Activity & Audit History Center (`ActivityHistoryPanel` & `HistoryStore`)**:
  - Persistent Hive-backed history store (`HistoryStore`, up to 200 entries per category) with filter tabs for **`All`**, **`Commands`** (terminal commands, exit status, stdout snippet, host target, 1-tap **Re-Run** and **Copy**), **`Connections`** (connect/disconnect/pairing/diagnostics audit log), and **`WoL`** (magic packet dispatch history), plus search filtering, JSON export, and confirmation-guarded Clear History.
- **Advanced Touch, Stream & Secret-Stripping Config Backup (`apps/mobile/lib/services/app_preferences.dart`)**:
  - Added granular preferences for Default Touch Input Mode (`Direct Touch` vs `Trackpad`), Trackpad Sensitivity (`0.5x`–`3.0x`), Natural Scroll, Long-Press Right-Click delay (`300`–`1000ms`), Haptic Feedback, Remote Cursor Overlay, Target FPS (`30`/`45`/`60`), Quality Preset (`Low Latency` / `Balanced` / `High Quality`), Auto-Reconnect, Heartbeat Interval (`5s`/`10s`/`15s`/`30s`), and Discovery Timeout.
  - Added **JSON Config Backup & Restore** (`exportConfigJson` / `importConfigJson`) that explicitly strips pairing secrets, tokens, and cryptographic keys while validating imported value ranges.

### 5. Zero-Config LAN UDP Discovery, 5-Stage Diagnostics & Build Hardening
- **LAN UDP Discovery (`CST_DISCOVER_V1` on UDP 8766) & 5-Stage Connection Diagnostics (`agent/agent.py`, `apps/mobile/lib/services/lan_discovery_service.dart`, `ui/connection_diagnostics_sheet.dart`)**:
  - Added UDP 8766 broadcast/unicast discovery responder in the Host Agent and `LanDiscoveryService` in the mobile app for sub-second LAN host detection without slow `/24` TCP port scans.
  - Added `ConnectionDiagnosticsSheet` to inspect LAN reachability, TCP 8765 socket health, TLS certificate verification, Mutual ECDH/AEAD session state, and video pipeline throughput.
- **1-Click Builders, Live E2E Orchestrator & Flutter 3.50 / AGP 9.3.1 Compliance (`BUILD_APK.bat`, `BUILD_EXE.bat`, `LAUNCH_AND_TEST.bat`, `scripts/launch_and_test_daemon.py`, `apps/mobile/android/`)**:
  - Added root `BUILD_APK.bat`, `BUILD_EXE.bat`, and `LAUNCH_AND_TEST.bat` (`scripts/launch_and_test_daemon.py`) for automated toolchain verification, firewall/ADB reverse setup, test execution, and live cryptographic daemon probing.
  - Migrated `apps/mobile/android/app/build.gradle` and plugins for Flutter 3.50 / AGP 9.3.1 Built-in Kotlin compatibility (removing imperative `id "kotlin-android"` and replacing the legacy `home_widget` plugin with a first-party native `MethodChannel("com.cst.autonomouslan/home_widget")` handler in `MainActivity.kt`), and hardened `--no-pub` release plugin registrant generation.

---

## Release Deliverables (`v0.90.0` / `0.90.00`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.90.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with GUI, tray & Guided Setup |
| `AI_NetController_HostAgent_v0.90.0_win64_portable.zip` | Windows x64 | Signed `--onedir` archive containing Host Agent build, source, and MSIX manifest |
| `AI_NetController_v0.90.0_arm64-v8a.apk` | Android 7.0–16 (`arm64-v8a`) | Compact 64-bit native Flutter Android APK (`0.90.00-beta`, `versionCode 900`) |
| `AI_NetController_v0.90.0.apk` | Android Universal (`arm64-v8a`, `armeabi-v7a`, `x86_64`) | Multi-ABI universal native Flutter Android APK (`0.90.00-beta`, `versionCode 900`) |
| `SHA256SUMS.txt` | All Platforms | Authoritative SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All Platforms | Machine-readable release metadata, file sizes, and SHA-256 asset manifest |

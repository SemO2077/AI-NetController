# AI NetController Beta 0.100.00 (`v0.100.0`) — Patch Notes

**AI NetController Beta 0.100.00 (`v0.100.0`)** is a comprehensive **cross-tier Quality-of-Life (QOL), visual polish, performance, and reliability** release across the **Python Host Agent (`agent/`)**, **Flutter Mobile Companion (`apps/mobile/`)**, and **React + Express Web Control Console (`apps/web/`)**.

---

## What's New & Changed in Update `0.100.00` (`v0.100.0`)

### 1. Python Host Agent Concurrency, Leak Hardening, Telemetry & Tray/GUI Polish (`agent/`)
- **Thread-Safe Input Cleanup & Async Teardown Hardening (`agent/agent.py`, `agent/network_fuzzer_shield.py`)**:
  - Guarded `_client_pressed_buttons` with `_pressed_buttons_lock` and FIFO executor draining on `_input_executor` so client disconnects, panic stops, and `kill_all_tasks()` cleanly release stuck mouse buttons strictly after queued `mouseDown` actions without cross-thread dictionary mutation races.
  - Eliminated unawaited coroutine `RuntimeWarning`s during synchronous daemon shutdown and fixed UDP `8766` discovery teardown (`_close_udp_discovery_async`) so sockets release immediately without `[WinError 10048]` port contention.
  - Added web/mobile key and hotkey alias normalization (`ArrowUp`, `Escape`, `Control`, etc.) while preserving all blocked system combinations, native Win32 UTF-16 clipboard fallback with lock-contention retries, HiDPI cursor hotspot scaling, and hardened `is_local_or_private_ip` geofencing against IPv4-mapped IPv6 (`::ffff:8.8.8.8`) and scoped link-local addresses.
- **Idle Resource Savings & Core Subsystem Hardening (`agent/multi_monitor_streamer.py`, `agent/daemon_config.py`, `agent/host_file_writer.py`, `agent/tls_manager.py`, `agent/agent_daemon.py`)**:
  - Added `release_idle_buffers()` after 15 seconds of stream inactivity, honored live `is_paused` gating without grabbing frames, serialized DXGI capture switches via `_dxgi_lock`, invalidated MSS `_monitors` cache for hot-plug detection, and added `is_primary`/`is_active` monitor metadata.
  - Cached hardened config directories (`_HARDENED_DIRS`) to avoid repeating NTFS `SetNamedSecurityInfoW` ACL writes on every 1-second config poll, zeroized decrypted DPAPI buffers before `LocalFree`, preserved `udp_discovery_enabled`/`discovery_port`/`target_fps` across saves, and backed up corrupt `config.json` files prior to clean recovery.
  - Serialized TLS certificate generation (`_TLS_LOCK`) with Windows `os.replace` retry and `psutil` NIC SAN discovery, added thread-safe file transfer abort checks and concurrent disk-space reservation in `HostFileWriter`, and fixed `HostDaemonState(host=None, port=None)` startup crashes via `agent_daemon.py`.
- **Backward-Compatible Additive Telemetry & Desktop GUI / Tray Ergonomics (`agent/agent.py`, `agent/agent_gui.py`, `agent/cyber_ui_theme.py`)**:
  - Added optional additive fields to `OP_TELEMETRY` (`target_fps`, `jpeg_quality`, `capture_backend`, `jpeg_encoder`, `tls_enabled`, `security_profile`, `monitors_count`, `is_locked`, `is_paused`, `capabilities`) and zero-secret `get_status_summary()` while preserving the 6-key zero-secret UDP discovery contract.
  - Cancelled all dangling Tkinter `after` timers on live theme swap, shutdown, and window destroy; added inline `"COPIED ✓"` feedback across copy buttons, compact `COPY IP` (`host:port`) and Console `Copy Logs` controls, live dynamic tray tooltips with `Copy LAN Endpoint` / `Copy 6-Digit PIN` actions, PIN `<60s` warning tints, and upgraded `TEXT_TERTIARY` contrast + 4-module QR quiet zones.

### 2. Flutter Mobile Companion Fleet UX, WCAG Contrast & Streaming Controls (`apps/mobile/`)
- **Fleet Dashboard, Pinning, Filtering, Sorting & Contrast Studio (`main.dart`, `fluid_theme.dart`, `responsive_device_card.dart`, `host_snapshot_preview.dart`, `app_preferences.dart`, `lan_discovery_service.dart`)**:
  - Introduced `CyberPalette.contrastInkFor()` (WCAG relative luminance crossover `0.184`) powering `onPrimary`, `onSecondary`, `onWarning`, `onAccent`, and `onHeroGradient` across all 6 color presets, Dark & Daylight polarities, and all 3 glass modes.
  - Added backward-compatible pinned/favorite hosts (`isPinned`), persisted `FleetSortMode` (`Default`, `Online First`, `Name A–Z`, `Lowest Ping`), `All` / `Online` / `Sleeping` / `Pinned` filter chips, compact search toggle, and 1-tap copy for IP, MAC, and Endpoint with inline checkmark feedback.
  - Fixed narrow-screen (`280px` at `1.35×` text scale) `ResponsiveDeviceCard` and `NavigationRail` badge overflows, hid redundant collapsed CTAs when cards expand, trimmed `0%` offline telemetry noise, and added optional MAC metadata parsing + APIPA (`169.254.x.x`) filtering in `LanDiscoveryService`.
- **Settings Command-Deck, WoL Hub, Activity History & Diagnostics (`settings_command_deck.dart`, `wol_hub_panel.dart`, `activity_history_panel.dart`, `connection_diagnostics_sheet.dart`, `adaptive_layout_builder.dart`, `samsung_pill_nav_bar.dart`)**:
  - Upgraded Settings search with multi-word tokenized matching and clickable empty-search suggestion chips, added WoL custom-target clear buttons & status filters, Activity History `Errors (N)` filter + filtered JSON/CSV export, and 1-tap full Diagnostics copy.
  - Replaced `Future.delayed` dialog controller disposals with dedicated `StatefulWidget` dialogs, capped `BackdropFilter` sigma (skipping blur behind opaque modal sheets), and added `RepaintBoundary` + `.select(...)` rebuild reductions.
- **Fullscreen Streaming HUD, Sticky Remote Keyboard & Pipeline Hardening (`fullscreen_stream_page.dart`, `viewport_stream_widget.dart`, `remote_keyboard_bar.dart`, `pip_stream_viewer.dart`, `host_connection_client.dart`, `frame_decrypt_isolate.dart`, `zero_gc_video_pipeline.dart`, `thermal_governor.dart`, `file_transfer_engine.dart`)**:
  - Isolated 120Hz pinch-to-zoom and the draggable HUD restore pill inside `ValueNotifier` + `ValueListenableBuilder` so zooming/panning never rebuilds parent HUD backdrops.
  - Added 1-tap `FPS:15/30/60` toggling in the stream dock, RTT health color coding, high-contrast Liquid Glass Daylight status overlays, 3-finger fullscreen HUD toggle, and sticky 1-shot/long-press-locked modifier latches (`CTRL`, `ALT`, `SHIFT`, `WIN`) with active combo banner, expandable `MACROS`, and `PUSH`/`PULL` clipboard pills on `RemoteKeyboardBar`.
  - Added `onExit` fallback on `FrameDecryptIsolate` so unexpected isolate exits degrade cleanly to synchronous decryption without deadlocking, O(1) `ListQueue` frame throughput pruning, PiP accelerometer pausing when backgrounded/reduced-motion, and immediate `ABORT` wakeup on `FileTransferEngine.cancel()`.

### 3. Web Control Console Fleet Cards, Screen Viewer HUD, Terminal & Server Hardening (`apps/web/`)
- **Fleet Dashboard, Host Cards, Cyber Glass Contrast & Topology (`FleetDashboard.tsx`, `HostCard.tsx`, `NetworkTopologyGraph.tsx`, `index.css`, `App.tsx`, `FloatingPillNav.tsx`)**:
  - Balanced the 3-column desktop grid (removing expanded `col-span-2` orphan gaps), prevented collapsed host-title truncation on desktop (`1440px`) and mobile (`390px`), removed redundant expanded icon buttons, and upgraded IP, MAC, WS-URI, RTT signal, Battery, and Pin controls into comfortable accessible pills with instant copy feedback.
  - Added persisted `Pinned` filter, `Load (CPU/RAM)` sort, `Servers` count badge, active filter reset bar, Escape-to-clear search, Topology `RTT: —` formatting + Cyber Glass empty-state overlay + mobile filter bar, and verified 221-key BG/EN i18n parity via automated Pillar 22 checks.
  - Registered `@utility ink-primary/secondary/muted` Tailwind v4 helpers, deepened Daylight contrast, trimmed nested `backdrop-filter` passes, paused ambient GPU animations when tab-hidden, wrapped the app in `<MotionConfig reducedMotion="user">`, and throttled specular glint tracking via `requestAnimationFrame`.
- **Remote Screen Viewer, Terminal, Omnibar, Settings & Modals (`ScreenViewerModal.tsx`, `CommandTerminal.tsx`, `CommandOmnibar.tsx`, `SettingsScreen.tsx`, `AuditLogViewer.tsx`, `MemoryManager.tsx`, `GeminiChatbot.tsx`, modals)**:
  - Hid the remote cursor reticle and gesture hint until a live unpaused frame arrives, restored crisp Dark & Light contrast inside `.dark-video-stage`, reorganized the viewer into a 2-row responsive Stream HUD (`1080p/720p/480p`, `60/30/15fps`, Fit/Fill, zoom, multi-monitor, Clipboard Sync, Quick Actions scroll arrows + `Tab`/`Ctrl+C`/`Ctrl+V` macros), and moved cursor coordinates to zero-re-render DOM refs.
  - Added `localStorage`-persisted Up/Down terminal history with draft preservation, 1-click Copy Command/Output/Endpoint, `.txt` session export, honest target-host status banners, optically centered Omnibar (`10vh`) with interactive `>`/`@`/`/` mode pills, wrapping mobile Settings tabs with zero clipping, Light-mode AI code block contrast rescue, and replaced 228 undefined CSS custom properties across modals with canonical tokens.
- **Worker & Express Server Reliability (`server.ts`, `networkWorker.ts`, `screenStore.ts`, `useFleetState.ts`, `useWorkerEngine.ts`)**:
  - Added atomic temp+rename JSON writes, coalesced concurrent `/api/hosts/scan` requests, safe `ws.send` guards, `.venv` Python resolution, `EADDRINUSE` diagnostics, clean `SIGINT`/`SIGTERM` shutdown, debounced host persistence with `pagehide` flush, and tracked Blob URL revocation timers.

---

## Release Deliverables (`v0.100.0` / `0.100.00`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.100.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with GUI, tray & Guided Setup |
| `AI_NetController_HostAgent_v0.100.0_win64_portable.zip` | Windows x64 | Signed `--onedir` archive containing Host Agent build, source, and MSIX manifest |
| `AI_NetController_v0.100.0_arm64-v8a.apk` | Android 7.0–16 (`arm64-v8a`) | Compact 64-bit native Flutter Android APK (`0.100.00-beta`, `versionCode 1000`) |
| `AI_NetController_v0.100.0.apk` | Android Universal (`arm64-v8a`, `armeabi-v7a`, `x86_64`) | Multi-ABI universal native Flutter Android APK (`0.100.00-beta`, `versionCode 1000`) |
| `SHA256SUMS.txt` | All Platforms | Authoritative SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All Platforms | Machine-readable release metadata, file sizes, and SHA-256 asset manifest |

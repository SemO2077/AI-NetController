# AI NetController v0.33.0 — Release Notes

**AI NetController v0.33.0** delivers a comprehensive performance, security, and reliability upgrade across the Windows Host Agent, Express Control Server, React Web Console, and Native Android Companion App.

---

## What's New in v0.33.0

### Speed & Runtime Optimizations
- **Low-Overhead Host Telemetry (`agent/agent.py`)**: Cached static OS and hostname descriptors at startup and streamlined the 2-second heartbeat loop.
- **Fast-Path Binary Packet Shield (`agent/network_fuzzer_shield.py`)**: Added an O(1) bypass path for production binary frames when simulation fault injection is disabled.
- **Backend I/O Caching (`apps/web/server.ts`)**: Added a 30-second in-memory cache for `/api/releases` (invalidated automatically on binary rebuilds), 5-second TTL caching for disk (`fs.statfsSync`) and network adapter (`os.networkInterfaces`) snapshots, and cached Python runtime version detection.
- **120 Hz Mobile Animation Tuning (`CommandOmnibar.tsx`)**: Critically damped spring physics (`stiffness: 520, damping: 36`) and solid dark surfaces eliminate scroll and modal jitter on high-refresh mobile screens.

### Security Hardening
- **Windows LOLBin Protection (`securityService.ts` & `server.ts`)**: Blocked living-off-the-land remote payload download/execution patterns (`certutil -urlcache`, `bitsadmin /transfer`, `mshta http`, `regsvr32 /i:http`).
- **Child-Process Secret Scrubbing (`command_ast_firewall.py` & `server.ts`)**: Sanitized child process environments (`createSafeChildEnv`) to strip API keys and pairing tokens (`GEMINI_API_KEY`, `AI_AGENT_SECRET`, `GITHUB_TOKEN`, etc.) before executing shell commands.
- **Android Local Server Hardening (`scripts/build_android_app.py`)**: Added path traversal (`..`) protection and CSPRNG token generation (`SecureRandom`) in `MainActivity.java`.

### Bug Fixes & Feature Completeness
- **Fixed Android Daemon State JSON**: Resolved a missing quote in `MainActivity.buildDaemonStateJson()` so `/api/daemon/state` and `/api/daemon/action` return valid JSON on Android.
- **Full SecureOn Wake-on-LAN Parity**: Added 6-byte hexadecimal SecureOn password support (108-byte magic packets) to the Express `/api/wol` endpoint.
- **Live GUI Telemetry Counters**: Connected `commands_executed` and `frames_broadcast` counters in `agent/agent.py` to the native Tkinter Control Center GUI.

---

## Release Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.33.0_win64.exe` | Windows x64 | Standalone Windows Host Agent executable |
| `AI_NetController_HostAgent_v0.33.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent and launchers |
| `AI_NetController_v0.33.0_arm64-v8a.apk` | Android ARM64 | Signed Android package optimized for `arm64-v8a` devices |
| `AI_NetController_v0.33.0.apk` | Android Universal | Universal Android installation package |
| `RELEASE_MANIFEST.json` | All | Build metadata and asset manifest |
| `SHA256SUMS.txt` | All | SHA-256 checksums for all release binaries |

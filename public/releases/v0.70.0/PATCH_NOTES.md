# AI NetController Beta 0.70.00 (`v0.70.0`) — Release Notes

**AI NetController Beta 0.70.00 (`v0.70.0`)** delivers a unified public-ready milestone featuring a ground-up Flutter mobile rebuild with responsive fluid UI, a guided PC Host Daemon setup & customization experience with Windows Install/Uninstall lifecycle, 3D Cyber-Glass executable & APK icons, end-to-end Web/Daemon/Android action synchronization, and full-stack dependency upgrades to the latest stable versions.

---

## Highlights in Beta 0.70.00

### 1. Rebuilt Flutter Mobile App & Responsive Multi-Aspect UI (`apps/mobile/`)
- **Ground-Up Rebuild & Optimization**: Eliminated redundant code, tightened frame-streaming memory and binary protocol paths (`0xC5 0x71`), and migrated state management and biometric authentication to `flutter_riverpod 3.5.0` and `local_auth 3.0.2`.
- **3D Beveled Cyber Glass & Subtle Animations**: Replaced flat panels with layered Cyber Glass depth, subtle micro-animations, and smoother transitions across dashboards and modals.
- **Full Viewport & Aspect-Ratio Scaling**: Refined responsive scaling from ultra-compact phones (`280x653`) up to wide tablets and foldables (`1440x900`) so controls remain legible and accessible without clipping or overflow.
- **Native 3D Launcher Iconage**: Bundled custom 3D Cyber-Glass adaptive and mipmap icons (`@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`).

### 2. Upgraded PC Host Daemon, Setup Wizard & Install/Uninstall (`agent/`)
- **Cyber Glass Control Center & Feature Customizer**: Upgraded desktop Control Center styling (`CyberUITheme`), added a 2-column feature customizer, and introduced a 3-step Guided Setup Wizard for first-time configuration and QR pairing.
- **Granular Startup & Module Toggles**: Added interactive controls for Run on Startup (synced with Windows Startup registry), File Transfer (`file_transfer_enabled`), Audio Control (`audio_control_enabled`), Ollama Bridge (`ollama_bridge_enabled`), Start Minimized, Close to Tray, Target FPS, and daemon Pause state.
- **Seamless Windows Install & Uninstall**: Integrated Win32 Add/Remove Programs registration, shortcut management, and `MoveFileExW` deferred self-delete cleanup (`perform_full_uninstall`), plus standalone onefile SFX `.EXE` and portable `--onedir` `.ZIP` builds stamped with the 3D Cyber-Glass icon.

### 3. Unified Web/Android Bridge & Full-Stack Dependency Upgrades (`apps/web/`, `scripts/`)
- **End-to-End Action Parity**: Synchronized all `/api/daemon/action` endpoints across `apps/web/server.ts`, `agent/daemon_config.py`, `agent/agent.py` (including `DISCONNECT_CLIENT` and per-client trust/input controls), `agent/agent_gui.py`, and the Android WebView shell (`MainActivity.java`).
- **Latest Dependencies Across Every Runtime**:
  - **Python (`agent/requirements.txt`)**: `Pillow 13.0.0`, `websockets 17.4`, `zeroconf 0.154.0`, `PyTurboJPEG 2.6.1`, `numpy 2.5.4`, `mss 10.2.0+`, `cryptography 50.0.2+`, `psutil 7.2.2+`, `pyinstaller 6.22.3+`.
  - **Flutter (`apps/mobile/pubspec.yaml`)**: `flutter_riverpod ^3.5.0`, `local_auth ^3.0.2`, `home_widget ^0.10.0`, `network_info_plus ^8.2.2`, `sensors_plus ^7.1.1`, `share_plus ^13.3.1`, `wakelock_plus ^1.8.2`, `flutter_lints ^6.0.0`.
  - **Node.js / Web (`package.json`)**: `vite 8.3.8`, `express 5.3.0`, `typescript 7.0.2`, `@google/genai 3.3.0`, `@tailwindcss/vite 4.3.5`, `lucide-react 1.73.0`, `motion 14.14.0`, `recharts 3.10.1`, `zustand 5.1.0` (`0` npm audit vulnerabilities).

---

## Release Deliverables (`v0.70.0`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.70.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with GUI, tray & Guided Setup |
| `AI_NetController_HostAgent_v0.70.0_win64_portable.zip` | Windows x64 | Signed `--onedir` archive containing Host Agent build, source, and MSIX manifest |
| `AI_NetController_v0.70.0_arm64-v8a.apk` | Android 10–15 (arm64-v8a) | Signed native Android APK package (`0.70.00-beta`, versionCode `700`) |
| `AI_NetController_v0.70.0.apk` | Android Universal | Signed universal APK package (`0.70.00-beta`, versionCode `700`) |
| `SHA256SUMS.txt` | All | SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All | Machine-readable release metadata and asset manifest |

# AI NetController — 1-Click Binary Compilation & Deployment Guide

**Version:** `v2.9.0-LTS` (Previous `v2.8.0-LTS`, `v2.7.1-LTS`, and `v2.7.0-LTS` preserved in releases)  
**Protocol:** `AI-NET/3.0-SECURE`  
**Platform Targets:** Windows 10/11 x64 PE32+ (`.EXE`), Android 10–15 (`.APK`)

This guide details the procedure for producing the standalone native binaries (`.exe` and `.apk`) for the Computer Systems & Technologies (CST) system.

---

## 1. Windows Host Agent Daemon (`AI_NetController_HostAgent_v2.9.0_win64.exe`)

### Security & Antivirus False-Positive Hardening
The compilation pipeline is specifically configured to pass Windows Defender and EDR heuristic analysis cleanly (`0/72` clean):
- **Zero UPX Compression (`upx=False`)**: Disabled in `agent/build_agent.spec` to avoid packed entropy flags (`Win32/Wacatac.B!ml`).
- **Foreground Desktop Window (`HWND`)**: Bundles standard Tkinter GUI runtime so the binary registers as a visible desktop utility rather than a headless background service.
- **Pure-Python System Inspection**: Eliminates hidden `powershell.exe` subprocesses on launch.
- **Embedded PE Version Info & UAC Manifest**: Official version resource metadata and `asInvoker` execution level.
- **Authenticode SHA-256 Code Signing**: Signed with `CN=AI NetController, O=AI_NetController, C=BG`.

### Automated CLI Compilation Method
```powershell
# 1. Navigate to agent directory
cd agent

# 2. Activate Python environment
python -m venv venv
.\venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt

# 3. Compile standalone executable with PyInstaller
pyinstaller --clean build_agent.spec

# 4. Sign binary with Authenticode certificate and run Defender scan check:
powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -ExePath dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe
```

Output:
- Standalone Executable: `agent/dist/AI_NetController_HostAgent/AI_NetController_HostAgent.exe` (or `AI_NetController_HostAgent_v2.9.0_win64.exe`)
- Portable ZIP: Packaged via `Compress-Archive` into `AI_NetController_HostAgent_v2.9.0_win64_portable.zip`.

---

## 2. Android Mobile Application (`AI_NetController_v2.9.0_arm64-v8a.apk`)

### 120Hz Zero-Jitter Display Pipeline
The Android client is compiled with:
- **Flutter 3.29 / Dart 3.7** with Impeller engine.
- **Dynamic 120Hz Refresh Rate Selector**: In `MainActivity.kt`, queries `display.supportedModes` to automatically set the hardware's maximum refresh rate (120Hz / 90Hz) via `preferredDisplayModeId`.
- **Hardware Acceleration**: `FLAG_HARDWARE_ACCELERATED` on the main window surface and `android.hardware.render_ahead = true` in `AndroidManifest.xml`.
- **Double-Buffered Pre-Allocated Ring Buffer**: `_DoubleFrameRingBuffer` in `zero_gc_video_pipeline.dart` eliminates heap garbage collection churn during desktop streaming.

### Compilation Method
```bash
# 1. Navigate to mobile app directory
cd apps/mobile

# 2. Clean and get dependencies
flutter clean
flutter pub get

# 3. Build optimized release APK with split ABIs
flutter build apk --release --split-per-abi
```

Output files in `apps/mobile/build/app/outputs/flutter-apk/`:
- **`app-arm64-v8a-release.apk`** (Recommended for modern 64-bit Android smartphones)
- **`app-armeabi-v7a-release.apk`** (Legacy 32-bit ARM hardware)
- **`app-x86_64-release.apk`** (Emulators and ChromeOS)

---

## 3. Physical LAN Verification Checklist
1. Launch `AI_NetController_HostAgent_v2.9.0_win64.exe` (or `v2.7.1` / `v2.7.0`) on target Windows PC. Confirm the Control Center window displays the local IP and pairing key.
2. Connect Android phone to the same Wi-Fi subnet.
3. Open the installed AI NetController Mobile app:
   - mDNS will discover the Windows PC host automatically within ~500ms.
   - Remote screen view, telemetry, and HITL security gating are operational immediately.

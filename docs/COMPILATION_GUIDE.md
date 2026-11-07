# Compilation Guide

This guide explains how to compile all **AI NetController** (`v0.32.0`) artifacts from source: the web bundle, the standalone Windows Host Agent executable, and the signed Android APK.

---

## 1. Web Dashboard & Control Server Bundle

### Build Requirements
- Node.js 20+
- npm 10+

### Build Steps
```bash
npm install
npm run lint
npm run build
```
The production frontend assets are output to `dist/` and served automatically by `apps/web/server.ts`.

---

## 2. Windows Host Agent (`.exe` & Portable `.zip`)

### Build Requirements
- Windows 10 or Windows 11 (x64)
- Python 3.11+
- PyInstaller (`pip install pyinstaller`)

### Automated Build Script
Run the release binary builder from the repository root:
```bash
python scripts/build_release_binaries.py
```

This script packages `agent/net_agent.py` and `agent/core/*` into:
- `public/releases/v0.32.0/AI_NetController_HostAgent_v0.32.0_win64.exe`
- `public/releases/v0.32.0/AI_NetController_HostAgent_v0.32.0_win64_portable.zip`

---

## 3. Native Android APK (`arm64-v8a` & Universal)

### Build Requirements
- Java Development Kit (JDK 17+)
- Android SDK (`platforms/android-34` and `build-tools/34.0.0`)
- Production web assets built (`npm run build`)

### Automated Build Script
Run the Android builder script from the repository root:
```bash
python scripts/build_android_app.py
```

### What the Script Does
1. Syncs the latest production web bundle (`dist/`) into the Android WebView asset directory (`apps/mobile/android_native/assets/www`).
2. Compiles the native Java sources (`apps/mobile/android_native/src/com/ainetcontroller/app/MainActivity.java`) against `android-34`.
3. Converts bytecode to DEX format with `d8`, packages resources with `aapt2`, `zipalign`s on 4-byte boundaries, and signs the APK with `apksigner` (V1 + V2 + V3 signatures).
4. Outputs the signed binaries to `public/releases/v0.32.0/`:
   - `AI_NetController_v0.32.0_arm64-v8a.apk`
   - `AI_NetController_v0.32.0.apk`

---

## 4. Generating Checksums & Release Manifest

Both `scripts/build_release_binaries.py` and `scripts/build_android_app.py` update `SHA256SUMS.txt` and `RELEASE_MANIFEST.json` inside `public/releases/v0.32.0/`.

To verify checksums on Windows PowerShell:
```powershell
Get-FileHash public/releases/v0.32.0/* -Algorithm SHA256
```

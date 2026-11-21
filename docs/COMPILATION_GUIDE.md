# Compilation & Release Packaging Guide

Instructions for building the **AI NetController** (`v0.90.0` / Beta `0.90.00`) web bundle, Windows Host Agent binaries, and Android APKs from source.

## 1. Web Production Bundle (`apps/web/`)

Prerequisites: Node.js `>= 22.0`, npm `>= 10.0`.

```bash
npm install
npm run lint
npm test
npm run build
```

Compiled static files are emitted to `apps/web/dist/` and served automatically by `npm start`.

## 2. Windows Host Agent (`agent/`)

Prerequisites: Windows 10/11 x64, Python 3.11+, Visual C++ Redistributable.

### Automated & Instant EXE Builders

```bash
# Instant 1-click Windows EXE & Portable ZIP builder (root or agent/)
BUILD_EXE.bat
# or
agent\build_exe.bat
# or via Python / npm
python scripts/build_release_binaries.py --exe-only
npm run build:exe
```

This packages the agent via PyInstaller (`agent/build_agent.spec`, warm incremental cache by default, `--onedir` + standalone EXE, `upx=False`, PerMonitorV2 manifest, 3D Cyber-Glass icons, and incremental Authenticode signing via `agent/sign_binary.ps1`), outputs `AI_NetController_HostAgent_v0.90.0_win64.exe` and `AI_NetController_HostAgent_v0.90.0_win64_portable.zip` to `public/releases/v0.90.0/`, and updates `SHA256SUMS.txt` and `RELEASE_MANIFEST.json`. Pass `--onedir-only` or `--fast` for rapid local dev iteration, or `--clean` to rebuild from a cold PyInstaller cache.

## 3. Android Companion Application (`apps/mobile/`)

### Instant Native Flutter APK Builder (Recommended)

Prerequisites: Flutter 3.29+ (`Dart 3.7+`), JDK 17+ (auto-detected from `JAVA_HOME`, Temurin 17/21, or Android Studio JBR), and Android SDK (`%LOCALAPPDATA%\Android\Sdk`).

```bash
# Instant 1-click APK builder (auto-detects Flutter, JDK, Android SDK, and keeps Gradle cache warm)
BUILD_APK.bat
# or
apps\mobile\build_apk.bat
# or via Python / npm
python scripts/build_android_app.py
npm run build:apk

# Fast arm64-v8a-only build (+ optional automatic ADB install to connected phone)
BUILD_APK.bat --fast --install
```

Generated APKs are placed under `apps/mobile/build/app/outputs/flutter-apk/` and staged to `public/releases/v0.90.0/AI_NetController_v0.90.0_arm64-v8a.apk` and `public/releases/v0.90.0/AI_NetController_v0.90.0.apk` with updated `SHA256SUMS.txt` and `RELEASE_MANIFEST.json`.

### Embedded WebView Shell APK Fallback

```bash
python scripts/build_android_app.py --webview-shell
```

## 3b. Unified Daemon Launcher & Live E2E Test Orchestrator

To provision configuration, TLS certificates, Windows Firewall rules (TCP `8765`, UDP `8766` `CST_DISCOVER_V1` LAN discovery, TCP `3000`, UDP `9` WoL), ADB reverse bridges, run automated tests, launch the Host Agent Daemon, and verify live WebSocket AEAD + UDP discovery readiness:

```bash
# Launch daemon + test suite + live E2E probe + Web Console
LAUNCH_AND_TEST.bat
# or
python scripts/launch_and_test_daemon.py

# Headless non-interactive self-test & live daemon verification (CI / smoke test)
LAUNCH_AND_TEST.bat --verify-only
npm run verify:daemon
```

## 4. Checksum Verification

Verify release artifact integrity against `public/releases/v0.90.0/SHA256SUMS.txt`:

```powershell
Get-FileHash public\releases\v0.90.0\* -Algorithm SHA256
```

```bash
sha256sum -c public/releases/v0.90.0/SHA256SUMS.txt
```

## 5. Publishing Releases (GitHub & GitLab)

Publish built release artifacts and checksums from `public/releases/<tag>/` to both mirrors using the unified dispatcher:

```bash
# Preview release artifacts and metadata without uploading
python scripts/publish_release.py --platform all --dry-run

# Publish to both GitHub Releases and GitLab Releases + Generic Packages
python scripts/publish_release.py --platform all --tag v0.90.0
```

You can also target a single mirror directly:

```bash
python scripts/publish_github_release.py --tag v0.90.0
python scripts/publish_gitlab_release.py --tag v0.90.0
```

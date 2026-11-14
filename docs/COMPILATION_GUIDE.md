# Compilation & Release Packaging Guide

Instructions for building the **AI NetController** (`v0.60.0` / Beta `0.60.00`) web bundle, Windows Host Agent binaries, and Android APKs from source.

## 1. Web Production Bundle (`apps/web/`)

Prerequisites: Node.js `>= 20.0`, npm `>= 10.0`.

```bash
npm install
npm run lint
npm test
npm run build
```

Compiled static files are emitted to `apps/web/dist/` and served automatically by `npm start`.

## 2. Windows Host Agent (`agent/`)

Prerequisites: Windows 10/11 x64, Python 3.11+, Visual C++ Redistributable.

### Automated Release Pipeline

```bash
python scripts/build_release_binaries.py
```

This packages the agent via PyInstaller (`agent/build_agent.spec`, `--onedir`, `upx=False`, PerMonitorV2 manifest, icons, and MSIX helpers), outputs `AI_NetController_HostAgent_v0.60.0_win64.exe` and `AI_NetController_HostAgent_v0.60.0_win64_portable.zip` to `public/releases/v0.60.0/`, and updates `SHA256SUMS.txt` and `RELEASE_MANIFEST.json`.

### Direct Local Build

```powershell
cd agent
build_exe.bat
```

## 3. Android Companion Application (`apps/mobile/`)

### Option A: Flutter Split-ABI Build (Full Flutter Companion)

Prerequisites: Flutter 3.29+ (`Dart 3.7+`) and Android SDK.

```bash
cd apps/mobile
flutter pub get
flutter build apk --release --split-per-abi
```

Generated APKs are placed under `apps/mobile/build/app/outputs/flutter-apk/`.

### Option B: Embedded WebView Shell APK Builder

Prerequisites: JDK 17+, Android SDK (`platforms/android-35`, `build-tools/35.0.0`), and a built web bundle (`npm run build`).

```bash
python scripts/build_android_app.py
```

Produces `AI_NetController_v0.60.0_arm64-v8a.apk` and `AI_NetController_v0.60.0.apk` in `public/releases/v0.60.0/`.

## 4. Checksum Verification

Verify release artifact integrity against `public/releases/v0.60.0/SHA256SUMS.txt`:

```powershell
Get-FileHash public\releases\v0.60.0\* -Algorithm SHA256
```

```bash
sha256sum -c public/releases/v0.60.0/SHA256SUMS.txt
```

## 5. Publishing Releases (GitHub & GitLab)

Publish built release artifacts and checksums from `public/releases/<tag>/` to both mirrors using the unified dispatcher:

```bash
# Preview release artifacts and metadata without uploading
python scripts/publish_release.py --platform all --dry-run

# Publish to both GitHub Releases and GitLab Releases + Generic Packages
python scripts/publish_release.py --platform all --tag v0.60.0
```

You can also target a single mirror directly:

```bash
python scripts/publish_github_release.py --tag v0.60.0
python scripts/publish_gitlab_release.py --tag v0.60.0
```

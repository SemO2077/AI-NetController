# Compilation Guide

This document describes how to compile all **AI NetController** (`v0.50.0` / Beta `0.50.00`) deliverables from source code:
1. The web production bundle (`apps/web/dist/`)
2. The standalone Windows Host Agent executable (`.exe`) and portable distribution archive (`.zip`)
3. The signed native Android application package (`.apk`)

---

## 1. Web Production Bundle

### Prerequisites
- Node.js 20.0+
- npm 10.0+

### Build Process
```bash
# Install dependencies
npm install

# Run static type checking and linting
npm run lint

# Compile production bundle
npm run build
```

Production static assets are emitted into `apps/web/dist/` and served automatically by `apps/web/server.ts` when running in production mode (`npm start`).

---

## 2. Windows Host Agent (`.exe` and Portable `.zip`)

### Prerequisites
- Windows 10 or Windows 11 (64-bit)
- Python 3.11 or later
- Visual C++ Redistributable (standard on modern Windows installations)

### Automated Build Pipeline
Run the release builder script from the repository root:
```bash
python scripts/build_release_binaries.py
```

### Packaging Pipeline Details
The script executes the following steps:
1. Validates the existence of all agent modules:
   - `agent/agent.py`
   - `agent/agent_daemon.py`
   - `agent/agent_gui.py`
   - `agent/command_ast_firewall.py`
   - `agent/crypto_handshake.py`
   - `agent/crypto_vault.py`
   - `agent/daemon_config.py`
   - `agent/host_file_writer.py`
   - `agent/icon_assets.py`
   - `agent/multi_monitor_streamer.py`
   - `agent/network_fuzzer_shield.py`
   - `agent/windows_integration.py`
2. Invokes PyInstaller using `agent/build_agent.spec`:
   - Configures `upx=False` across both single-file and directory outputs to prevent antivirus heuristics false positives.
   - Embeds the Per-Monitor V2 DPI manifest (`PerMonitorV2`).
   - Packages Windows icons (`agent/icon.ico`) and version metadata (`agent/version_info.txt`).
3. Outputs artifacts to `public/releases/v0.50.0/`:
   - `AI_NetController_HostAgent_v0.50.0_win64.exe` (Standalone PE32+ executable)
   - `AI_NetController_HostAgent_v0.50.0_win64_portable.zip` (Portable directory bundle with Python launcher)
4. Re-computes SHA-256 digests and updates `SHA256SUMS.txt` and `RELEASE_MANIFEST.json`.

---

## 3. Android Native Companion App (`.apk`)

### Prerequisites
- Java Development Kit (JDK 17 or JDK 21+)
- Android SDK:
  - Platform: `android-35` or `android-34` (`platforms/android-35/android.jar`)
  - Build-Tools: `35.0.0` or `34.0.0` (`aapt2`, `d8`, `zipalign`, `apksigner`)
- Web production bundle compiled (`npm run build`)

### Automated Build Pipeline
Run the Android build pipeline from the repository root:
```bash
python scripts/build_android_app.py
```

### Build Steps Executed
1. **Asset Synchronization**: Copies the compiled web application bundle (`apps/web/dist/`) into `apps/mobile/android_native_build/assets/web/`.
2. **Java Compilation**: Compiles the native bridge `MainActivity.java` against `android.jar` using `javac`.
3. **DEX Transformation**: Converts compiled `.class` files into optimized Android DEX bytecode (`classes.dex`) via `d8`.
4. **Resource Packaging**: Compiles XML resources and layout manifests with `aapt2` into `resources.arsc` and creates the unaligned package.
5. **Alignment**: Aligns uncompressed assets on 4-byte boundaries with `zipalign`.
6. **Cryptographic Signing**: Signs the final APK using `apksigner` with APK Signature Scheme V1, V2, and V3.
7. **Output**:
   - `public/releases/v0.50.0/AI_NetController_v0.50.0_arm64-v8a.apk`
   - `public/releases/v0.50.0/AI_NetController_v0.50.0.apk`

---

## 4. Verification and Integrity Validation

To calculate and verify the cryptographic checksums of all release binaries:

```powershell
Get-FileHash public\releases\v0.50.0\* -Algorithm SHA256
```

Compare the outputs against `public/releases/v0.50.0/SHA256SUMS.txt`.

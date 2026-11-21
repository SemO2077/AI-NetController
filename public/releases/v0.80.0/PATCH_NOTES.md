# AI NetController Beta 0.80.00 (`v0.80.0`) — Patch Notes

**AI NetController Beta 0.80.00 (`v0.80.0`)** is a major security, performance, and user-experience update unifying full-stack **Mutual X25519 + ChaCha20-Poly1305 AEAD** transport encryption, zero-bufferbloat **60 FPS hardware-accelerated screen streaming** across multi-monitor setups, encrypted **`CST-PAIR-X25519-V1` 6-digit PIN pairing**, expanded **Command AST Firewall** and SSRF/DNS-rebinding protections, and frictionless pairing & remote control ergonomics across Windows, Web, and Android.

---

## What's New & Changed in Update `0.80.00` (`v0.80.0`)

### 1. Zero-Bufferbloat 60 FPS Screen Streaming & Multi-Monitor Pipeline (`agent/`, `apps/web/`, `apps/mobile/`)
- **SIMD Host Capture & Backpressure Engine (`agent/agent.py`, `agent/multi_monitor_streamer.py`)**:
  - **Per-Monitor V2 DPI Awareness**: Enabled Windows `SetProcessDpiAwarenessContext(-4)` (`DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2`) with `SetProcessDPIAware()` fallback for sharp native-resolution capture on 125%–250% DPI displays without DWM scaling blur.
  - **SIMD `TurboJPEG` Fast-DCT Encoding**: Added `TJFLAG_FASTDCT` (`2048`) with `TJSAMP_420` chroma subsampling across `AdaptiveScreenPipeline` and `MultiMonitorStreamer` for sub-5ms frame encoding.
  - **2D Strided Delta Detection & High-Quality Settling Frame**: Sampled `img32[::8, ::16]` across the full 2D viewport to detect static screens accurately and emit 1 high-quality settling frame before pausing redundant duplicate encodings.
  - **Desktop Switch / UAC Auto-Recovery**: Replaced global `mss` sharing with thread-local `mss` instances and automatic `_reinit_mss()` recovery when Windows transitions across UAC prompts or lock screens.
  - **Explicit `OP_FRAME_SYNC` Flow Control**: Added `_send_frame_guarded` single-in-flight frame delivery and `OP_FRAME_SYNC` (`0xED`) acknowledgment gating (with a 250ms safety fallback) to eliminate TCP socket bufferbloat.
- **Zero-Allocation Web `<canvas>` Renderer (`apps/web/src/components/modals/ScreenViewerModal.tsx`, `apps/web/src/store/screenStore.ts`)**:
  - Bypassed React state re-renders and `URL.createObjectURL` GC churn on every video frame by decoding binary JPEG frames directly via `createImageBitmap(blob)` and painting onto a hardware-accelerated `<canvas>` inside `requestAnimationFrame`.
  - Added a live **FPS badge**, **AEAD encryption badge**, and a **150ms debounced `ResizeObserver`** that automatically negotiates optimal `STREAM_CONFIG` capture dimensions with the Host Daemon.
- **Flutter Mobile Impeller Pipeline (`apps/mobile/lib/services/zero_gc_video_pipeline.dart`, `apps/mobile/lib/ui/viewport_stream_widget.dart`)**:
  - Added copy-on-write ring-buffer collision protection (`writeSlot == readSlot`) in `_DoubleFrameRingBuffer`, single-flight `ui.instantiateImageCodec` GPU texture decoding, and `WidgetsBindingObserver` lifecycle hooks to pause `FrameSync` timers when the app is backgrounded.
  - Optimized LAN discovery in `apps/mobile/lib/main.dart` to scan local `/24` RFC 1918 subnets without spawning redundant fallback isolate waves.

### 2. Full-Stack Cryptographic Vault & Zero-Trust Transport (`agent/`, `apps/web/`, `apps/mobile/`)
- **Mutual X25519 + ChaCha20-Poly1305 AEAD Everywhere (`INIT_ECDH_VAULT_M` / `CST_ECDH_V2`)**:
  - Unified mutual 91-byte X25519 + HMAC-SHA256 handshakes (`INIT_ECDH_VAULT_M` / `ACK_ECDH_VAULT_M`), HKDF-SHA256 directional session key derivation (`c2h_key`, `h2c_key`, `c2h_iv_salt`, `h2c_iv_salt`), `CST_ECDH_V2` ChaCha20-Poly1305 AEAD wire framing, and 128-bit sliding-window replay defense across the Python Host Daemon (`agent/agent.py`), Node/Express Control Server (`apps/web/server.ts`), WebWorker socket engine (`apps/web/src/workers/networkWorker.ts`, `apps/web/src/utils/cryptoVault.ts`), and Flutter Mobile Client (`apps/mobile/lib/security/crypto_engine.dart`, `apps/mobile/lib/services/host_connection_client.dart`).
  - Enforced post-vault anti-downgrade (`HostAgentDaemon._aead_required()`) and fail-closed `require_aead` enforcement so unencrypted control packets are rejected once AEAD is active.
  - Added immediate ephemeral private key zeroization after handshake completion and strict TLS certificate validation (`agent/tls_manager.py`).
- **End-to-End Encrypted `CST-PAIR-X25519-V1` PIN Pairing (`apps/web/src/utils/cryptoVault.ts`, `agent/agent.py`, `apps/mobile/lib/services/host_connection_client.dart`)**:
  - Upgraded 6-digit PIN pairing (`PAIR_INIT` / `PAIR_FINISH`) to wrap the host shared secret inside an ephemeral X25519 + HKDF-SHA256 + AES-256-GCM / ChaCha20-Poly1305 envelope bound to the 6-digit PIN, ensuring pairing tokens never cross the LAN in cleartext.

### 3. Command AST Firewall, SSRF/DNS Rebinding & Platform Hardening
- **Expanded Command AST Firewall (`agent/command_ast_firewall.py`)**:
  - Intercepted additional high-risk PowerShell evasion and persistence cmdlets (`Set-MpPreference`, `Invoke-WmiMethod`, `Invoke-CimMethod`, `New-Service`, `Set-Service`, `Add-Content`, `Clear-EventLog`, `Remove-EventLog`, `Export-PfxCertificate`).
  - Hardened tokenization with quote-stripped normalization so multi-word destructive patterns cannot be bypassed via inline quotes.
- **SSRF, DNS Rebinding & Payload Bounds (`apps/web/server.ts`, `apps/web/src/utils/networkGuard.ts`, `apps/mobile/lib/security/network_validators.dart`)**:
  - Enforced strict RFC 1918 / RFC 4193 private-LAN target validation blocking cloud metadata endpoints (`169.254.169.254`), public internet hosts, and unbracketed IPv6 ambiguity.
  - Added DNS rebinding `Host` header validation (`isAllowedHostHeader`), constant-time `crypto.timingSafeEqual` secret comparisons, `/api/source-files` directory allowlisting (`CodeExportModal.tsx`), 8192-byte shell command bounds, and 1 MiB clipboard bounds.
- **Android Hardware Keystore, Startup Resilience & Biometric HITL Gating (`apps/mobile/`)**:
  - Enforced Android Keystore AES-GCM hardware storage (`SecureSecretStore`) with safe mutable key copying for Android `MethodChannel` byte views (`_UnmodifiableUint8ArrayView`), self-healing Keystore alias recovery in `MainActivity.kt`, guarded display refresh-rate setup, fault-tolerant Hive bootstrap recovery before `runApp()`, Android 12+ `<data-extraction-rules>` and `allowBackup="false"`, removed wildcard CORS (`Access-Control-Allow-Origin: *`) from the Android WebView loopback server (`MainActivity.java`), and gated HITL approvals (`sendHitlResponse(true)`) and high-risk commands behind `BiometricSecurityGate`.
  - Added full R8/ProGuard keep rules for JNI (`jni`, `jni_flutter`, `path_provider_android`) and Flutter plugins, upgraded Android build tooling to Gradle `9.5.0` / AGP `9.3.1` / Kotlin `2.4.20`, and shipped both a compact `arm64-v8a` APK and a true multi-ABI Universal APK (`arm64-v8a`, `armeabi-v7a`, `x86_64`) with consistent `versionCode 800`.

### 4. Frictionless Pairing, Remote Control UX & Verification Suites
- **1-Tap Deep-Link, Clipboard & Inline PIN Pairing**:
  - Added native Android `ainet://pair` deep-link handling (`MainActivity.kt` -> `main.dart`), automatic clipboard pairing link detection (`ainet://pair` and `#pair_ip=`), unmasked 6-digit PIN inputs with auto-submit on the 6th digit, auto-prompt PIN dialog when tapping an unpaired host, and an inline **Quick Pair (6-Digit PIN)** banner directly inside the Web Screen Viewer.
- **Rich In-Stream Remote Controls & Emergency Kill Switch**:
  - Added **Monitor Switcher** (`MON 1..N` / `ALL`), **Pull PC Clip** & **Push to PC** clipboard synchronization, **Double-Click** action button, and an inline **AI Approval Bar** (`Approve` / `Deny`) inside `ScreenViewerModal.tsx`.
  - Wired global **Panic Kill All** (`PANIC_KILL_ALL` authenticated control action) across Web, Mobile, and Host Agent to immediately terminate active child processes and revoke sessions.
  - Fixed `START_HERE_WINDOWS.bat` and `START_HERE_LINUX.sh` to auto-open `http://localhost:3000` and launch `agent/agent.py` with proper `PYTHONPATH`.
- **Automated Verification Suites**:
  - Added `agent/tests/test_screen_stream_and_hardening.py` and `apps/web/src/tests/verifyCryptoAndSecurity.ts` covering mutual ECDH, AEAD framing, replay defense, encrypted PIN pairing, AST firewall rules, and 60 FPS frame sync backpressure.

---

## Release Deliverables (`v0.80.0` / `0.80.00`)

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.80.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with GUI, tray & Guided Setup |
| `AI_NetController_HostAgent_v0.80.0_win64_portable.zip` | Windows x64 | Signed `--onedir` archive containing Host Agent build, source, and MSIX manifest |
| `AI_NetController_v0.80.0_arm64-v8a.apk` | Android 7.0–16 (`arm64-v8a`) | Compact 64-bit native Flutter Android APK (`0.80.00-beta`, `versionCode 800`) |
| `AI_NetController_v0.80.0.apk` | Android Universal (`arm64-v8a`, `armeabi-v7a`, `x86_64`) | Multi-ABI universal native Flutter Android APK (`0.80.00-beta`, `versionCode 800`) |
| `SHA256SUMS.txt` | All Platforms | Authoritative SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All Platforms | Machine-readable release metadata, file sizes, and SHA-256 asset manifest |

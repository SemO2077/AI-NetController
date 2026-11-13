# System Architecture

AI NetController connects three runtime tiers over local-area networks:

```text
  Android Companion (apps/mobile/)           Web Console (apps/web/)
  - Flutter / Dart, Riverpod, Hive           - React 19 + TypeScript + Tailwind
  - Keystore AES-GCM secret vault            - Vite SPA + Express control server
  - X25519 + ChaCha20-Poly1305 client        - Binary DataView framer & WoL UI
                  \                                       /
                   \    mDNS (_cst-agent._tcp.local)     /
                    \   ws:// or wss:// (port 8765)     /
                     v                                 v
                  +---------------------------------------+
                  | Host Agent Daemon (agent/agent.py)    |
                  | - Pre-auth firewall & IP rate limit   |
                  | - CommandASTFirewall + Job Object     |
                  | - Adaptive TurboJPEG / MSS capture    |
                  | - Cyber Glass Desktop GUI & Tray      |
                  | - Optional Ollama / AI bridge         |
                  +---------------------------------------+
```

## 1. Host Agent (`agent/`)

| Module | Responsibility |
| :--- | :--- |
| [`agent/agent.py`](../agent/agent.py) | WebSocket server (`websockets`), mDNS advertisement (`_cst-agent._tcp.local.`), pre-auth firewall, protocol dispatch, adaptive desktop capture, input injection, tray lifecycle |
| [`agent/agent_daemon.py`](../agent/agent_daemon.py) | Managed daemon supervisor, configuration watcher, and IPC control wrapper |
| [`agent/agent_gui.py`](../agent/agent_gui.py) & [`agent/cyber_ui_theme.py`](../agent/cyber_ui_theme.py) | Cyber Glass desktop control panel with live client telemetry, QR pairing card (ISO/IEC 18004 vector renderer), PIN TTL countdown, and HITL confirmation dialog |
| [`agent/command_ast_firewall.py`](../agent/command_ast_firewall.py) | Command normalization (Unicode NFKC, Windows caret/quote stripping), LOLBin/cradle filtering, three-tier risk classification (`SAFE`, `REQUIRES_BIOMETRIC`, `BLOCKED`), bounded `OrderedDict` cache, and escalating process teardown |
| [`agent/crypto_vault.py`](../agent/crypto_vault.py) & [`agent/crypto_handshake.py`](../agent/crypto_handshake.py) | X25519 key agreement, HKDF-SHA256 directional session keys, ChaCha20-Poly1305 AEAD, RFC 6479 sliding-window anti-replay, memory zeroization |
| [`agent/tls_manager.py`](../agent/tls_manager.py) | SAN-bound ECDSA P-256 certificate generator and SHA-256 pinning export |
| [`agent/daemon_config.py`](../agent/daemon_config.py) | Thread-safe atomic config store (`%LOCALAPPDATA%\AI NetController\config.json` / `~/.ai_netcontroller/config.json`) with Windows DPAPI secret sealing |
| [`agent/host_file_writer.py`](../agent/host_file_writer.py) | Chrooted `Downloads` file writer (`OP_FILE_TRANSFER`), disk space reservation, streaming SHA-256 checks, Windows Mark-of-the-Web ADS tagging |
| [`agent/multi_monitor_streamer.py`](../agent/multi_monitor_streamer.py) | Multi-display enumeration and switching (`OP_DISPLAY_ENUM`) |
| [`agent/windows_integration.py`](../agent/windows_integration.py) | Native Win32 COM shortcut and startup task integration |

### Process & Filesystem Containment

On Windows, child shell processes are bound to a single `WindowsJobSupervisor` Job Object enforcing a 256 MB memory cap and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, closing process handles immediately after assignment. All shell executions enforce strict timeouts with escalating termination (`SIGINT` -> `SIGTERM` -> `SIGKILL` / `TerminateProcess`).

## 2. Mobile Companion (`apps/mobile/`)

| Module Group | Responsibility |
| :--- | :--- |
| `lib/security/` | `SecureSecretStore` (Android Keystore hardware AES-GCM via `MainActivity.kt` `MethodChannel` with automatic legacy migration), `CryptoEngine`, `CryptoChannel`, `BiometricSecurityGate`, `NetworkValidators` |
| `lib/protocol/` | `BinaryProtocol` (`0xC5 0x71`, opcodes `0x01`–`0xEE`), synchronous `NetworkFramer` broadcast, bounded `PacketReassembler` |
| `lib/services/` | `HostConnectionClient` (`wss://` cert pinning, `INIT_ECDH_VAULT_M`, `PAIR_INIT`/`PAIR_FINISH`), `AppPreferencesNotifier` (Hive-backed persistent theme palette, FPS, TLS preference, command history), `ZeroGcVideoPipeline`, `FileTransferEngine`, `ThermalGovernor`, `OsIntegrationsManager` |
| `lib/theme/` & `lib/ui/` | Dynamic `CyberPalette` theming (`fluid_theme.dart`), responsive compact/medium/expanded scaffolds (`adaptive_layout_builder.dart`), hardware-accelerated stream viewer with 16 ms coalesced `OP_INPUT`, PiP viewer, onboarding sheet |

## 3. Control Server & Web Console (`apps/web/`)

- **Server (`apps/web/server.ts`)**: Binds `127.0.0.1` by default (optional `ALLOW_LAN_WEB` opt-in), authenticates control/state API routes, streams local agent binaries/manifests (`/api/releases`), serves whitelisted source exports (`/api/source-files`), generates host launcher scripts, and proxies optional Ollama or Gemini diagnostic requests.
- **Web App (`apps/web/src/`)**: React 19 UI with Zustand + `nativeStorage.ts` persistence (dual browser storage and Android WebView native bridge via `MainActivity.java`), `binaryFramer.ts` (`DataView` framing), Wake-on-LAN orchestrator (`wolService.ts`), WebSocket screen viewer, and client-side command pre-flight classification (`securityService.ts`).

## 4. Packaging & Verification Pipeline

- **Windows Host Agent (`scripts/build_release_binaries.py`)**: Builds `--onedir` + standalone launcher artifacts via PyInstaller (`upx=False`), embeds manifests and icons, supports Authenticode signing and MSIX packaging (`agent/package_msix.ps1`), and writes `SHA256SUMS.txt` and `RELEASE_MANIFEST.json`.
- **Android APK (`scripts/build_android_app.py`)**: Compiles and signs split/universal APKs aligned across version code `600` (`0.60.00-beta`).
- **Automated Tests**: Independently verified suites across Node/TypeScript (`npm test`, `npm run lint`), Python unittest (`agent/tests/`), and Flutter (`apps/mobile/test/`, including live Python daemon E2E loopback tests).

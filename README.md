# AI NetController

[![CI](https://github.com/SemO2077/AI-NetController/actions/workflows/ci.yml/badge.svg)](https://github.com/SemO2077/AI-NetController/actions/workflows/ci.yml)
[![GitLab Pipeline](https://gitlab.com/ryu-group7483245/ai-netcontroller/badges/main/pipeline.svg)](https://gitlab.com/ryu-group7483245/ai-netcontroller/-/pipelines)
[![Release v0.60.0](https://img.shields.io/badge/release-v0.60.0--beta-00f0ff)](https://github.com/SemO2077/AI-NetController/releases/tag/v0.60.0)
[![GitLab Release v0.60.0](https://img.shields.io/badge/gitlab_release-v0.60.0--beta-fc6d26)](https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/v0.60.0)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Low-latency workstation fleet manager, Wake-on-LAN orchestrator, and authenticated remote desktop bridge built across a Python host daemon (`agent/`), an Android/Flutter companion (`apps/mobile/`), and a local React + Express web console (`apps/web/`).

**Mirrors:** [GitHub (`SemO2077/AI-NetController`)](https://github.com/SemO2077/AI-NetController) | [GitLab (`ryu-group7483245/ai-netcontroller`)](https://gitlab.com/ryu-group7483245/ai-netcontroller)

## Capabilities

- **Framed Binary Wire Protocol (`0xC5 0x71`)**: 12-byte big-endian transport framing over WebSockets (`ws://` or `wss://`) handling desktop streaming, live hardware telemetry, virtual trackpad/keyboard input, clipboard sync, audio controls, multi-monitor selection, and chunked SHA-256 verified file transfer. See [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- **Cryptographic Transport & Secret Storage**: Constant-time `HMAC-SHA256` challenge-response, X25519 + ChaCha20-Poly1305 encrypted PIN pairing (`PAIR_INIT`/`PAIR_FINISH`), mutual `CST_ECDH_V2` AEAD sessions with HKDF-SHA256 directional keys and RFC 6479 128-bit replay protection, Windows DPAPI secret sealing, Android Keystore AES-GCM storage, and optional ECDSA P-256 `wss://` certificate pinning.
- **Process Containment & HITL Gating**: Command AST normalization and obfuscation stripping (`command_ast_firewall.py`), three-tier risk classification, Windows Job Object memory/lifetime limits (`WindowsJobSupervisor`), and operator confirmation (`OP_HITL`) before elevated command execution.
- **Adaptive Screen Capture & Companion UI**: TurboJPEG / Pillow / NumPy frame pipeline with display switching and viewport downsampling (`0x0A`, `0x0D`, `0xED`), synced desktop/mobile/web Cyber Glass UI, Hive and WebView persistent preferences, and optional local Ollama or Gemini diagnostics.

## Architecture

```text
+--------------------------+          ws:// or wss:// (port 8765)          +---------------------------+
| Mobile Companion         |  <==== 12-Byte Binary Protocol (0xC571) ====>  | Host Agent Daemon         |
| apps/mobile/ (Flutter)   |          X25519 + ChaCha20-Poly1305 AEAD      | agent/agent.py (Python)   |
+--------------------------+                                               | - mDNS (_cst-agent._tcp)  |
                                                                           | - AST Firewall & Job Obj  |
+--------------------------+          HTTP REST / Proxy (port 3000)        | - TurboJPEG Screen Stream |
| Web Control Console      |  <=========================================>  | - Cyber Glass Desktop UI  |
| apps/web/ (React + Node) |          127.0.0.1 loopback by default        +---------------------------+
+--------------------------+
```

For module responsibilities and security boundaries, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick Start

### 1. Host Agent (`agent/`)

Requires Python 3.11+ (Windows 10/11 recommended for Job Object process isolation and desktop tray integration).

```bash
pip install -r agent/requirements.txt
python agent/agent.py
```

Or launch directly from the root scripts:
- **Windows:** `START_HERE_WINDOWS.bat`
- **Linux/macOS:** `./START_HERE_LINUX.sh`

Useful daemon flags: `--headless`, `--port 8765`, `--install`, `--uninstall`, `--create-shortcut`. Configuration is saved to `%LOCALAPPDATA%\AI NetController\config.json` (Windows) or `~/.ai_netcontroller/config.json` (POSIX).

### 2. Web Control Console (`apps/web/`)

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
npm run dev
```

For production builds:

```bash
npm run build
npm start
```

By default, the Express server binds `127.0.0.1:3000` (`ALLOW_LAN_WEB=true` exposes it to LAN interfaces).

### 3. Mobile Companion (`apps/mobile/`)

Requires Flutter 3.29+ / Dart 3.7+ to develop or test from source. Pre-built signed APKs and Windows binaries are published under [GitHub Releases](https://github.com/SemO2077/AI-NetController/releases/tag/v0.60.0) and [GitLab Releases](https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/v0.60.0).

```bash
cd apps/mobile
flutter pub get
flutter build apk --release --split-per-abi
```

## Verification & Test Suites

All three subsystems ship automated verification suites:

```bash
# Web TypeScript check, architecture verification (40 checks), and stress benchmarks (23 checks)
npm run lint
npm test

# Python Host Agent unit, crypto, firewall, loopback, and integration tests (113 tests)
python -m unittest discover -s agent/tests -v

# Flutter static analysis and mobile unit/E2E daemon tests (24 tests; invokes Python host agent)
cd apps/mobile
flutter analyze
flutter test test/
```

## Repository Structure

```text
AI-NetController/
├── agent/                      # Python Host Agent daemon, firewall, crypto vault, TLS, Cyber Glass UI
│   ├── tests/                  # Host unit, edge-case, loopback, stress, and security tests
│   ├── agent.py                # Primary WebSocket daemon & screen capture pipeline
│   ├── agent_gui.py            # Desktop Control Center & QR pairing window
│   ├── command_ast_firewall.py # Command normalizer, obfuscation detector & Job Object supervision
│   ├── crypto_vault.py         # X25519, HKDF-SHA256, ChaCha20-Poly1305 & RFC 6479 replay guard
│   ├── daemon_config.py        # Atomic config persistence with Windows DPAPI secret sealing
│   ├── host_file_writer.py     # Chrooted file receiver with Mark-of-the-Web & SHA-256 verification
│   ├── tls_manager.py          # SAN ECDSA P-256 certificate generator & fingerprint export
│   └── build_agent.spec        # PyInstaller --onedir Windows build configuration
├── apps/
│   ├── mobile/                 # Flutter Android/desktop client (Riverpod, Keystore vault, AEAD engine)
│   └── web/                    # React 19 UI + Express control server
├── docs/
│   ├── PROTOCOL.md             # Binary wire protocol, opcodes, ECDH/AEAD & HITL specification
│   ├── ARCHITECTURE.md         # Cross-tier architecture & security model
│   ├── SETUP_GUIDE.md          # Installation, daemon configuration & pairing walkthrough
│   └── COMPILATION_GUIDE.md    # Building web dist, Windows agent binaries, and Android APKs
├── scripts/                    # Release build, packaging, checksum & release publishing utilities
├── .github/                    # GitHub Actions CI & issue/PR templates
├── .gitlab/                    # GitLab issue/MR templates
├── .gitlab-ci.yml              # GitLab CI/CD pipeline
├── PATCH_NOTES.md              # v0.60.0 (Beta 0.60.00) changelog
└── package.json                # Node scripts & version metadata
```

## Documentation

- [Protocol Specification](docs/PROTOCOL.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Setup & Pairing Guide](docs/SETUP_GUIDE.md)
- [Compilation & Release Packaging Guide](docs/COMPILATION_GUIDE.md)
- [Contributing Guide](CONTRIBUTING.md)
- [v0.60.0 Release Notes](PATCH_NOTES.md)

## License

Released under the [MIT License](LICENSE).

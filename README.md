# AI NetController

[![Release](https://img.shields.io/github/v/release/SemO2077/AI-NetController?color=00e5ff)](https://github.com/SemO2077/AI-NetController/releases)
[![CI](https://github.com/SemO2077/AI-NetController/actions/workflows/ci.yml/badge.svg)](https://github.com/SemO2077/AI-NetController/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20Android-green.svg)](#architecture)

**AI NetController** is a workstation fleet management and remote operations platform designed for local networks. It provides real-time system and network telemetry, low-latency desktop streaming, Wake-on-LAN scheduling, command execution through an AST security firewall, and AI-assisted troubleshooting.

The system consists of three main components:
1. **Windows Host Agent**: A native Python daemon and desktop utility (`agent/`) that exposes system metrics, captures screen frames, and runs verified commands within a sandboxed environment.
2. **Control Server & Web Console**: A Node.js (Express) server and React 19 single-page dashboard (`apps/web/`) providing real-time telemetry graphs, network topology maps, and fleet management controls.
3. **Android Mobile Companion**: A native Android client (`apps/mobile/`) providing mobile device monitoring, Wake-on-LAN packet transmission, and touch-optimized remote input.

---

## Release Downloads (Beta 0.51.00 / v0.51.0)

Pre-built binaries and deployment archives are available on the [GitHub Releases page](https://github.com/SemO2077/AI-NetController/releases/tag/v0.51.0):

| Artifact | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.51.0_win64.exe` | Windows 10/11 x64 | Standalone signed Host Agent executable with system tray & GUI |
| `AI_NetController_HostAgent_v0.51.0_win64_portable.zip` | Windows x64 | Portable bundle containing agent binaries, source, and launchers |
| `AI_NetController_v0.51.0_arm64-v8a.apk` | Android 10–15 (arm64-v8a) | Signed native Android application package (`0.51.00-beta`) |
| `AI_NetController_v0.51.0.apk` | Android Universal | Signed universal APK package (`0.51.00-beta`) |
| `SHA256SUMS.txt` | All | Cryptographic checksums for binary integrity verification |

To verify artifact integrity on Windows:
```powershell
Get-FileHash public\releases\v0.51.0\* -Algorithm SHA256
```

---

## System Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │          React 19 Web Dashboard              │
                  │   (Telemetry Charts, Topology, HITL Gate)    │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTP / REST / WebSocket
                                         ▼
┌────────────────────────┐        ┌──────────────────────────────┐
│ Android Companion App  │        │   Node.js / Express Server   │
│ (Subnet Scanner, WoL)  │◄──────►│   (State Store, Rate Limits) │
└────────────────────────┘        └──────────────┬───────────────┘
                                                 │
                                                 │ Binary WebSocket
                                                 │ (ws://<host>:8765)
                                                 ▼
                  ┌──────────────────────────────────────────────┐
                  │             Windows Host Agent               │
                  │                                              │
                  │  ┌─────────────────┐    ┌─────────────────┐  │
                  │  │ Protocol Shield │    │  AST Firewall   │  │
                  │  │ (0xC571 Framing)│    │  (Deobfuscation)│  │
                  │  └────────┬────────┘    └────────┬────────┘  │
                  │           │                      │           │
                  │  ┌────────▼────────┐    ┌────────▼────────┐  │
                  │  │ DXGI / mss      │    │ Windows Job     │  │
                  │  │ Screen Capture  │    │ Object Sandbox  │  │
                  │  └─────────────────┘    └─────────────────┘  │
                  └──────────────────────────────────────────────┘
```

---

## Key Capabilities

### Telemetry & Remote Control
- **Low-Overhead Telemetry**: Streams CPU, RAM, disk I/O, network throughput, and per-adapter statistics at 1-2 second intervals over binary WebSockets.
- **Desktop Streaming**: Delta-encoded JPEG frame streaming with dynamic quality adjustment and viewport resolution synchronization.
- **Remote Input**: Pointer motion, mouse clicks, mouse wheel scrolling, keyboard shortcuts, and bidirectional clipboard synchronization.
- **Directed Wake-on-LAN**: Broadcasts standard IEEE 802.3 magic packets (`FF*6 + MAC*16`) with support for optional 6-byte SecureOn passwords, cron scheduling, and fleet power status tracking.
- **L2/L3 Network Topology**: Force-directed D3 visualization of discovered nodes, link latency, host states, and host isolation controls.

### Security Controls
- **Command AST Firewall**: Inspects shell commands before execution, de-obfuscating evasion patterns (caret insertions, backtick abuse, environment substring slicing) and blocking dangerous utilities (`format`, `diskpart`, `vssadmin`, `certutil`, `bitsadmin`, `mshta`, `regsvr32`).
- **Process Sandboxing**: Spawns approved commands inside Windows Job Objects with memory limits (`256 MB`) and `KILL_ON_JOB_CLOSE` semantics to prevent orphan background processes.
- **Environment Scrubbing**: Automatically removes sensitive environment variables (`AI_AGENT_SECRET`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, etc.) before launching child processes.
- **Human-in-the-Loop (HITL) Gate**: Flags elevated-risk administrative actions for explicit operator confirmation prior to dispatch.
- **Protocol Shielding**: Enforces strict 12-byte header validation, monotonic sequence numbering, sliding-window anti-replay tracking, and token-bucket rate limiting.

### AI Diagnostics
- **Local & Cloud Model Support**: Query diagnostics and system triage recommendations using local models via Ollama (`http://localhost:11434`) or cloud models via the Google Gemini API.
- **Contextual Troubleshooting**: Correlates process lists, network adapter status, and event metrics into structured diagnostic summaries.

---

## Binary Wire Protocol

All real-time communication between the Host Agent and control clients uses a compact binary protocol over WebSockets.

### Header Format (12 Bytes Packed)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Magic 0     |   Magic 1     |    Opcode     |     Flags     |
|    (0xC5)     |    (0x71)     |               |               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Sequence Number                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Payload Length                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Payload Data (Variable)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

Packed struct definition: `!BBBBII` (big-endian).

### Protocol Opcodes

| Opcode | Identifier | Direction | Purpose |
| :--- | :--- | :--- | :--- |
| `0x01` | `OP_PING` | Bidirectional | Latency probe and connection keep-alive |
| `0x02` | `OP_TELEMETRY` | Agent → Controller | Serialized system and interface metrics |
| `0x03` | `OP_FRAME` | Agent → Controller | Desktop JPEG frame data |
| `0x04` | `OP_SHELL` | Controller → Agent | Remote command execution request |
| `0x05` | `OP_HITL` | Bidirectional | Approval request and operator confirmation response |
| `0x06` | `OP_AUTH` | Bidirectional | Nonce exchange, pairing challenge, and authentication |
| `0x07` | `OP_CLIP` | Bidirectional | Clipboard text synchronization |
| `0x08` | `OP_INPUT` | Controller → Agent | Mouse motion, click, and keyboard keystroke events |
| `0x09` | `OP_AUDIO` | Agent → Controller | PCM audio frame streaming |
| `0x0A` | `OP_VIEWPORT_RESIZE` | Controller → Agent | Remote display resolution configuration |
| `0x0B` | `OP_LLM_STREAM` | Agent → Controller | Streaming diagnostic output chunk |
| `0x0C` | `OP_FILE_TRANSFER` | Bidirectional | Chunked file transfer (init, chunk, ack, finish) |
| `0xEE` | `OP_ERR` | Bidirectional | Protocol-level error notification |

---

## Repository Structure

```text
AI-NetController/
├── .github/
│   └── workflows/
│       └── ci.yml                  # Automated CI workflow (Node.js & Python test matrix)
├── agent/                          # Windows / Linux Python Host Agent
│   ├── agent.py                    # Main agent daemon, WebSocket server & telemetry loop
│   ├── agent_daemon.py             # Service daemon with system tray integration
│   ├── agent_gui.py                # Native Tkinter desktop control center GUI
│   ├── command_ast_firewall.py     # AST command de-obfuscation & Job Object sandbox
│   ├── crypto_handshake.py         # Pairing handshake & challenge-response authentication
│   ├── crypto_vault.py             # Windows DPAPI secure secret storage
│   ├── daemon_config.py            # Persistent host configuration (%LOCALAPPDATA%\AI NetController)
│   ├── host_file_writer.py         # Chunked file receiver with path traversal guards
│   ├── multi_monitor_streamer.py   # Multi-monitor desktop capture & delta JPEG compression
│   ├── network_fuzzer_shield.py    # Binary frame validation & token-bucket rate limiter
│   ├── windows_integration.py      # Autostart registry, shortcuts & Windows Job Objects
│   └── tests/                      # Unit, edge-case, and security test suite (73 tests)
├── apps/
│   ├── web/                        # Control Server and Dashboard
│   │   ├── server.ts               # Express API and LAN control server
│   │   ├── src/                    # React 19 UI components, Zustand stores, D3 graphs
│   │   └── src/tests/              # 14-pillar verification & quantitative benchmark tests
│   └── mobile/                     # Android companion project
│       ├── android/                # Native Android application configuration
│       └── android_native_build/   # Compiled Android APK build output
├── docs/                           # Technical documentation
│   ├── SETUP_GUIDE.md              # Installation and initial configuration guide
│   └── COMPILATION_GUIDE.md        # Source compilation instructions for all platforms
├── public/
│   └── releases/                   # Versioned release binaries, manifests, and checksums
└── scripts/                        # Reproducible build and release automation scripts
    ├── build_release_binaries.py   # Windows standalone executable builder
    ├── build_android_app.py        # Native Android APK compilation pipeline
    ├── publish_github_release.py   # GitHub Releases automated publishing script
    └── publish_release.py          # Unified release dispatch tool
```

---

## Quick Start

### 1. Prerequisites

- **Node.js**: v20.0 or later
- **Python**: v3.11 or later
- **Windows 10 / 11** (for the Host Agent with native Job Object sandboxing)

### 2. Start the Control Server & Dashboard

```bash
git clone https://github.com/SemO2077/AI-NetController.git
cd AI-NetController
npm install
npm run dev
```

Open `http://localhost:3000` in your web browser.

### 3. Launch the Windows Host Agent

#### Option A: Run Prebuilt Executable
Download and run `AI_NetController_HostAgent_v0.51.0_win64.exe` from [GitHub Releases](https://github.com/SemO2077/AI-NetController/releases/tag/v0.51.0).

#### Option B: Run from Source
```bash
pip install -r agent/requirements.txt
python agent/agent.py
```

### CLI Command Options for Host Agent

```bash
# Run with desktop GUI (default)
python agent/agent.py

# Run in headless mode (background daemon without GUI)
python agent/agent.py --headless

# Install as Windows startup service with desktop shortcut
python agent/agent.py --install

# Uninstall Windows autostart service and remove shortcuts
python agent/agent.py --uninstall

# Bind to a custom port or host
python agent/agent.py --host 192.168.1.100 --port 8765
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Control server HTTP port | `3000` |
| `AI_AGENT_SECRET` | Shared secret token for host-to-server authentication | Auto-generated |
| `GEMINI_API_KEY` | Optional Google Gemini API key for cloud AI diagnostics | Unset |
| `OLLAMA_HOST` | Endpoint for local LLM diagnostics | `http://localhost:11434` |

### Configuration Storage

On Windows, the Host Agent persists paired client tokens, display capture settings, and service preferences to:
```
%LOCALAPPDATA%\AI NetController\config.json
```

---

## Quality Assurance & Verification

The project includes unit test suites, security boundary verifications, and stress benchmark harnesses:

```bash
# TypeScript compiler type check and lint
npm run lint

# Architecture verification (40 pillars) and stress benchmarks (23 benchmarks)
npm test

# Python Host Agent test suite (73 unit and security tests)
python -m unittest discover -s agent/tests

# Compile production web assets
npm run build
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, branch conventions, and testing requirements.

---

## Security Policy

See [SECURITY.md](SECURITY.md) for vulnerability disclosure guidelines and security architecture details.

---

## License

This project is licensed under the [MIT License](LICENSE).

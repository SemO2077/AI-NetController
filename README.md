# AI NetController

[![Version](https://img.shields.io/badge/version-v0.33.0-00e5ff.svg)](https://github.com/smehmedd/AI-NetController/releases/tag/v0.33.0)
[![Build](https://img.shields.io/badge/build-passing-10b981.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**AI NetController** is a cross-platform network telemetry, remote desktop streaming, Wake-on-LAN, and AI-assisted system administration toolkit for Windows and Android. It pairs a native Python Windows Host Agent (`agent/agent.py` & `agent/agent_gui.py`) with a React 19 / Express control server and a hardware-accelerated native Android companion app.

---

## Downloads (v0.33.0)

Download the prebuilt binaries from [GitHub Releases](https://github.com/smehmedd/AI-NetController/releases/tag/v0.33.0):

| Platform | Package | Description |
| :--- | :--- | :--- |
| **Windows (x64)** | `AI_NetController_HostAgent_v0.33.0_win64.exe` | Standalone Windows Host Agent executable with Desktop GUI |
| **Windows (x64)** | `AI_NetController_HostAgent_v0.33.0_win64_portable.zip` | Portable archive with Host Agent source and launchers |
| **Android (ARM64)** | `AI_NetController_v0.33.0_arm64-v8a.apk` | Signed Android app (`arm64-v8a`) |
| **Android (Universal)** | `AI_NetController_v0.33.0.apk` | Standard Android installation package |

---

## Core Features

### Telemetry, Remote Control & Wake-on-LAN
- **Live System & Network Telemetry**: Real-time CPU, RAM, disk, interface throughput, latency, and active adapter monitoring over binary WebSockets (`ws://<host>:8765`).
- **120 Hz Desktop Streaming & Remote Input**: Low-latency delta-hashed JPEG screen streaming with virtual trackpad, keyboard shortcuts, and clipboard sync.
- **Directed Wake-on-LAN (WoL)**: Native UDP Magic Packet broadcaster (`FF*6 + MAC*16`) with optional 6-byte SecureOn password support, cron scheduling, and fleet energy estimation.
- **Interactive L2/L3 Topology Graph**: Force-directed D3 network topology visualization with live node health, latency badges, and quarantine controls.

### Zero-Trust Security & AI Diagnostics
- **AST Command Firewall**: Pre-execution command de-obfuscation (`^`, backticks, environment slices), Windows LOLBin blocking (`certutil`, `bitsadmin`, `mshta`, `regsvr32`), and child-process secret scrubbing.
- **Human-in-the-Loop (HITL) Approval Gate**: High-risk system operations require explicit operator confirmation before execution.
- **Packet Fuzzer & Replay Shield**: Binary frame validation (`0xC5 0x71`), RFC 6479 sliding-window replay protection, and token-bucket rate limiting.
- **AI SysAdmin Assistant**: Natural-language diagnostics and fleet triage powered by local Ollama models (`DeepSeek-R1`, `Llama-3.3`, `Qwen-2.5`) or Google Gemini.

### Native Android App
- **Adaptive Mobile UI**: Responsive 4-tab bottom navigation bar on phones and an automatic side navigation rail on tablets and foldables.
- **Embedded Local Asset & LAN Bridge**: Multi-threaded `/24` LAN subnet scanner, native UDP Wake-on-LAN broadcaster, edge-to-edge system bar integration, and hardware back-navigation handling.

---

## Project Structure

```text
AI-NetController/
├── agent/                          # Windows/Linux Python Host Agent
│   ├── agent.py                    # Core WebSocket daemon, screen streamer & telemetry loop
│   ├── agent_gui.py                # Native Tkinter Desktop Control Center GUI
│   ├── command_ast_firewall.py     # AST command verifier & Windows Job Object sandbox
│   ├── network_fuzzer_shield.py    # Binary wire-protocol verifier & token-bucket shield
│   ├── zero_trust_pairing.py       # Ephemeral X25519 / ChaCha20-Poly1305 & RFC 6479 anti-replay
│   └── tests/                      # Unit test suite for agent security & protocol modules
├── apps/
│   ├── web/                        # React 19 + TypeScript + Express control server
│   │   ├── server.ts               # Express API & LAN control server (port 3000)
│   │   └── src/                    # Dashboard UI components, state stores, and workers
│   └── mobile/                     # Flutter & Native Android companion project
├── docs/                           # Setup, compilation, and architecture guides
├── scripts/                        # Reproducible binary & APK build scripts
└── tests/                          # Architecture and stress test suites
```

---

## Quick Start

### 1. Run the Control Server & Web Dashboard

Prerequisites: **Node.js 20+** and **Python 3.11+**.

```bash
git clone https://github.com/smehmedd/AI-NetController.git
cd AI-NetController
npm install
npm run dev
```

Open `http://localhost:3000` in your browser, or run `START_HERE_WINDOWS.bat` on Windows (`./START_HERE_LINUX.sh` on Linux/macOS).

### 2. Run the Windows Host Agent

Run the prebuilt `AI_NetController_HostAgent_v0.33.0_win64.exe`, or launch the desktop agent from source:

```bash
pip install -r agent/requirements.txt
python agent/agent.py
```

---

## Testing & Verification

```bash
# Run TypeScript compiler verification
npm run lint

# Run architecture and stress test suites
npm test

# Run Python Host Agent unit tests
python -m unittest discover -s agent/tests
```

For full build instructions, see the [Setup Guide](docs/SETUP_GUIDE.md) and [Compilation Guide](docs/COMPILATION_GUIDE.md).

---

## License

Released under the [MIT License](LICENSE).

# AI NetController

[![Version](https://img.shields.io/badge/version-v0.32.0-00e5ff.svg)](#)
[![Build](https://img.shields.io/badge/build-passing-10b981.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**AI NetController** is a cross-platform network telemetry, QoS orchestration, and wireless diagnostics toolkit for Windows and Android. It pairs a native Python Windows Host Agent (`psutil`, `scapy`, `netsh`, `tshark`) with a React/Express control dashboard and a native Android companion app.

---

## Downloads (v0.32.0)

Grab the prebuilt binaries from the [GitHub Releases page](https://github.com/smehmedd/AI-NetController/releases/tag/v0.32.0):

| Platform | Package | Description |
| :--- | :--- | :--- |
| **Windows (x64)** | `AI_NetController_HostAgent_v0.32.0_win64.exe` | Standalone Windows Host Agent executable |
| **Windows (x64)** | `AI_NetController_HostAgent_v0.32.0_win64_portable.zip` | Portable archive with Host Agent and checksums |
| **Android (ARM64)** | `AI_NetController_v0.32.0_arm64-v8a.apk` | Signed Android app (`arm64-v8a`) |
| **Android (Universal)** | `AI_NetController_v0.32.0.apk` | Standard Android installation package |

---

## Core Features

### Telemetry & Diagnostics
- **Live Interface Metrics**: Real-time upload/download throughput, packet rates, jitter, and latency monitoring.
- **Process Network Attribution**: Per-process socket inspection mapping active connections and bandwidth usage to local PIDs and executables.
- **Wireless Environment Scanner**: 2.4 GHz, 5 GHz, and 6 GHz channel congestion analysis, BSSID signal mapping, and co-channel interference detection.
- **Deep Packet Inspection**: Live protocol breakdown (`TCP`, `UDP`, `TLSv1.3`, `QUIC`, `DNS`, `HTTP/3`) and Flow/Sequence diagrams with `.pcap` and `.csv` export.

### Traffic Control & Optimization
- **QoS Policy Profiles**: Automated DSCP packet tagging and Windows `netsh` TCP parameter tuning for Gaming, Streaming, VoIP, and Bulk transfer workloads.
- **Per-Application Bandwidth Rules**: Priority queueing and rate-limiting rules managed directly from the desktop dashboard or mobile app.
- **AI Diagnostics Assistant**: Local-first network troubleshooting powered by Ollama (`Llama-3`, `Mistral`, `Qwen-2.5`) or optional cloud providers (`Gemini`, `OpenAI`, `Claude`).

### Native Android App
- **Responsive Mobile Dashboard**: Adaptive navigation (bottom bar on phones, navigation rail on tablets/foldables) with hardware-accelerated telemetry charts and 60–120 Hz frame pacing.
- **LAN Host Discovery**: Automatic mDNS/UDP subnet scanning and manual pairing with the Windows Host Agent over WebSockets (`ws://<host>:3000`).
- **Remote Policy Switching**: Apply QoS profiles, inspect active sockets, and run latency checks from your phone.

---

## Project Structure

```text
AI-NetController/
├── agent/                  # Windows Host Agent (Python, Scapy, psutil)
│   ├── net_agent.py        # Main privilege-aware daemon and WebSocket client
│   ├── core/               # Telemetry, Wi-Fi scanning, DPI, and QoS modules
│   └── tests/              # Unit test suite for agent modules
├── apps/
│   ├── web/                # React 19 + TypeScript + Express control server
│   │   ├── server.ts       # Express API & WebSocket bridge (port 3000)
│   │   └── src/            # Dashboard UI components, state, and telemetry views
│   └── mobile/             # Native Android app & Flutter project
│       └── android_native/ # Native Android WebView shell + LAN bridge
├── docs/                   # Setup and compilation guides
├── scripts/                # Build, verification, and release automation scripts
└── tests/                  # Integration and stress tests
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

Open `http://localhost:3000` in your browser.

### 2. Run the Windows Host Agent

Run the prebuilt `AI_NetController_HostAgent_v0.32.0_win64.exe` as Administrator, or launch it from source:

```bash
pip install -r requirements.txt
python agent/net_agent.py --server http://localhost:3000
```

> **Note**: Running as Administrator enables Windows QoS policy creation (`New-NetQosPolicy`), raw socket capture, and `netsh int tcp` tuning. Without elevation, the agent runs in read-only telemetry mode.

---

## Testing & Verification

```bash
# Run TypeScript typecheck and lint
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

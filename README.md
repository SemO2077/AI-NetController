# CST NetController AI

[![Release](https://img.shields.io/badge/release-v3.1.0--beta.2-blue.svg)](https://github.com/smehmedd/AI-NetController/releases/tag/v3.1.0-beta.2)
[![Channel](https://img.shields.io/badge/channel-public%20beta-amber.svg)](https://github.com/smehmedd/AI-NetController/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-116%20passed%2C%200%20failed-brightgreen.svg)](https://github.com/smehmedd/AI-NetController)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776ab.svg)](https://www.python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6.svg)](https://www.typescriptlang.org)
[![Android](https://img.shields.io/badge/Android-7.0%20--%2015-3ddc84.svg)](https://developer.android.com)

A self-hosted workstation fleet management platform, Wake-on-LAN orchestrator, and remote diagnostic engine for local area networks and homelabs.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Core Capabilities](#core-capabilities)
- [Pre-Compiled Binaries (Beta Channel)](#pre-compiled-binaries-beta-channel)
- [Quick Start](#quick-start)
  - [Option 1: Using Pre-Compiled Binaries](#option-1-using-pre-compiled-binaries)
  - [Option 2: Running from Source](#option-2-running-from-source)
- [Network Ports & Firewall Configuration](#network-ports--firewall-configuration)
- [Wake-on-LAN Configuration Checklist](#wake-on-lan-configuration-checklist)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Repository Structure](#repository-structure)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [License](#license)

---

## Overview

CST NetController AI is designed for system administrators, IT lab operators, and homelab users who need reliable workstation discovery, power management, remote execution, and screen monitoring over a local network.

All core functionality operates entirely within the local area network:
- No mandatory cloud dependencies or third-party relay servers.
- Direct workstation-to-controller communication over WebSocket.
- Optional assisted triage via Google Gemini API for command generation and log analysis.
- Multi-platform support spanning Windows, Linux, and Android.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CONTROLLER CLIENTS                               │
│                                                                             │
│   Web Console (PWA)                     Android Companion App               │
│   React 19 + TypeScript + Vite          Native WebView + Hardware Engine    │
└──────────────────────┬──────────────────────────────────┬───────────────────┘
                       │ HTTP / WebSocket                 │
                       ▼                                  │
┌──────────────────────────────────────┐                  │
│          CENTRAL ORCHESTRATOR        │                  │
│          Node.js Express Server      │                  │
│   • Subnet Discovery & WoL Broadcast │                  │
│   • Multi-Turn AI Model Router       │                  │
│   • Session & Telemetry Registry     │                  │
└──────────────────────┬───────────────┘                  │
                       │                                  │
                       │ Direct Binary WebSocket (8765)   │
                       ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TARGET MANAGED WORKSTATION                         │
│                                                                             │
│   Host Agent Daemon (agent/agent.py)                                        │
│   • Tkinter Desktop Control Center GUI (agent_gui.py)                       │
│   • AsyncIO Binary Protocol Server (agent_daemon.py)                        │
│   • AST Command Safety Inspector & Process Sandbox                          │
│   • Screen Streamer with Spatial Delta Compression                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Capabilities

### 1. Workstation Fleet Management
- Real-time heartbeat tracking with RFC 3550 round-trip time (RTT) and network jitter telemetry.
- Resource telemetry monitoring: CPU load, RAM usage, battery status for mobile hosts, and host uptime.
- Host grouping by operating system (Windows / Linux), device type, and custom tags.
- Interactive network topology diagram powered by D3 force simulation.

### 2. Wake-on-LAN Engine
- Standard IEEE 802.3 Magic Packet generation and RFC 5494 SecureOn password protection.
- Pre-computed 256-byte lookup tables for zero-allocation packet formatting.
- Directed subnet broadcasting (`/24`) and global broadcast (`255.255.255.255`) on UDP ports 9 and 7.
- Automated recurring wake schedules with day-of-week recurrence.
- Energy consumption and cost estimation based on active vs. standby host hours.

### 3. Remote Shell & Command Safety
- Interactive terminal console with command history, status badges, and execution timing.
- Abstract Syntax Tree (AST) command firewall that parses shell commands before execution to identify and block destructive commands (`rm -rf /`, drive formatting, malicious PowerShell).
- Human-in-the-Loop (HITL) authorization gates for elevated commands.
- Monotonic anti-replay nonces and token-based pairing between controllers and workstations.

### 4. Display Streaming & Remote Input
- Low-latency desktop screen mirroring with 4×4 block spatial delta compression to minimize bandwidth.
- Display presets supporting standard 16:9, 16:10, 21:9 ultrawide, and fit-to-window aspect ratios.
- Remote mouse click, cursor repositioning, and keystroke injection (`Opcode 0x08`).
- Emergency kill-switch and view-only mode to prevent remote input while keeping the screen visible.

### 5. Android Companion Application
- Direct hardware tile composition via Android WebView container running at native screen refresh rates (up to 144Hz).
- Hardware `WindowInsets` safe-area integration to adapt cleanly to camera cutouts, navigation bars, and soft keyboards.
- Complete visual layout containment: zero horizontal overflow on any display width from 320px foldables to large tablets.
- Background local subnet discovery and 1-tap Wake-on-LAN dispatcher.

---

## Pre-Compiled Binaries (Beta Channel)

All releases are provided under the public beta channel. Binaries are pre-compiled and verified clean:

| Artifact | Platform | Size | Direct Download |
| :--- | :--- | :---: | :---: |
| **`CST_HostAgent_v3.1.0_win64.exe`** | Windows 10 / 11 x64 (GUI + Service) | 35.3 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_HostAgent_v3.1.0_win64.exe) |
| **`CST_HostAgent_v3.1.0_win64_portable.zip`** | Windows 10 / 11 x64 (Portable Bundle) | 35.0 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_HostAgent_v3.1.0_win64_portable.zip) |
| **`CST_NetController_AI_v3.1.0_arm64-v8a.apk`** | Android 7.0 – 15 (`arm64-v8a`) | 1.31 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_NetController_AI_v3.1.0_arm64-v8a.apk) |
| **`CST_NetController_AI_v3.1.0.apk`** | Android 7.0 – 15 (Universal) | 1.31 MB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/CST_NetController_AI_v3.1.0.apk) |
| **`SHA256SUMS.txt`** | Checksums | 413 B | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/SHA256SUMS.txt) |
| **`RELEASE_MANIFEST.json`** | Metadata Manifest | 1.9 KB | [Download](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.2/RELEASE_MANIFEST.json) |

Previous beta releases (`v3.1.0-beta.1`, `v3.0.0`, `v2.9.0`, `v2.8.0`, `v2.7.1`, `v2.7.0`) are cataloged on the [Releases Page](https://github.com/smehmedd/AI-NetController/releases).

---

## Quick Start

### Option 1: Using Pre-Compiled Binaries

1. **On Target Windows Workstations**:
   - Download [`CST_HostAgent_v3.1.0_win64.exe`](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/CST_HostAgent_v3.1.0_win64.exe).
   - Launch the executable. The desktop GUI will display your local IP, port (`8765`), and pairing token.
   - Click **Allow** if Windows Defender Firewall prompts for network access on private networks.

2. **On Android Devices**:
   - Download [`CST_NetController_AI_v3.1.0_arm64-v8a.apk`](https://github.com/smehmedd/AI-NetController/releases/download/v3.1.0-beta.1/CST_NetController_AI_v3.1.0_arm64-v8a.apk).
   - Install the package on your device.
   - Connect to the same Wi-Fi subnet. The app will discover managed workstations automatically.

---

### Option 2: Running from Source

#### Prerequisites
- Node.js 20.x or 22.x LTS
- Python 3.11 or 3.12
- Git 2.40+

#### 1. Web Console & Orchestrator

```bash
# Clone the repository
git clone https://github.com/smehmedd/AI-NetController.git
cd AI-NetController

# Install dependencies
npm install

# Start development server
npm run dev

# Or build for production and run
npm run build
npm start
```
The web console is accessible at `http://localhost:3000`.

#### 2. Host Agent Daemon (Windows / Linux)

```bash
cd agent

# Create virtual environment
python -m venv venv

# Windows
.\venv\Scripts\activate
# Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run desktop GUI
python agent.py

# Or run headless daemon (ideal for servers or background services)
python agent.py --headless --port 8765
```

#### 3. Building Android APK from Source

```powershell
python scripts/build_android_app.py
```
The compiled, aligned, and signed APK will be output to `public/releases/v3.1.0-beta.1/`.

---

## Network Ports & Firewall Configuration

Ensure these ports are allowed on your router or local firewall across the private subnet:

| Port | Protocol | Direction | Component | Description |
| :--- | :---: | :---: | :--- | :--- |
| **`3000`** | TCP | Inbound | Web Console | HTTP web interface and REST / WebSocket API |
| **`8765`** | TCP | Inbound | Host Agent | Workstation control socket, telemetry, and screen streaming |
| **`9` / `7`** | UDP | Outbound | WoL Broadcaster | IEEE 802.3 and SecureOn Wake-on-LAN packets |
| **`5353`** | UDP | Multicast | mDNS | RFC 6762 local service discovery (`_cst-agent._tcp.local.`) |

#### Quick Firewall Configuration

```powershell
# Windows (Run as Administrator)
New-NetFirewallRule -DisplayName "CST Host Agent (TCP 8765)" -Direction Inbound -LocalPort 8765 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "CST Web Console (TCP 3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
```

```bash
# Linux (UFW)
sudo ufw allow 8765/tcp comment 'CST Host Agent'
sudo ufw allow 3000/tcp comment 'CST Web Console'
```

---

## Wake-on-LAN Configuration Checklist

Wake-on-LAN operates at the hardware data-link layer. If a target machine fails to power on:

1. **Ethernet Connection**: WoL requires a physical wired connection on most consumer and enterprise network cards (Wi-Fi adapters generally power down entirely in S5 shutdown state).
2. **Motherboard BIOS/UEFI Settings**:
   - Enable **Power On By PCI-E / LAN** or **Wake on LAN**.
   - Disable **ErP Ready / Deep Sleep** (ErP removes standby 5V power from the network controller).
3. **Operating System Settings (Windows)**:
   - Device Manager → Network Adapters → Ethernet NIC → Properties → **Advanced**.
   - Set **Wake on Magic Packet** to **Enabled**.
   - Under **Power Management**, check **Allow this device to wake the computer** and **Only allow a magic packet to wake the computer**.
4. **Disable Windows Fast Startup**:
   Windows Fast Startup puts the OS into a hybrid sleep state that can prevent network adapters from listening for Magic Packets. In an Administrator terminal:
   ```powershell
   reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f
   ```

---

## Testing & Quality Assurance

The codebase includes automated verification across architectural pillars, stress benchmarks, and agent sandboxing:

```bash
# 1. Architectural Verification (40 tests) & Multi-Resolution Stress Tests (23 tests)
npm test

# 2. TypeScript and Lint Verification (0 errors)
npm run lint

# 3. Python Host Agent Security, Sandbox & Diagnostics Tests (53 tests)
python -m unittest discover -s agent/tests
```

**Total automated test coverage**: 116 passing tests across Web, Core, and Agent subsystems.

---

## Repository Structure

```text
AI-NetController/
├── agent/                         # Python Host Agent Daemon
│   ├── agent.py                   # Entry point (GUI or --headless mode)
│   ├── agent_gui.py               # Tkinter desktop control center
│   ├── agent_daemon.py            # AsyncIO WebSocket server & screen streamer
│   ├── command_ast_firewall.py    # AST safety analyzer & command validator
│   ├── requirements.txt           # Python dependencies
│   ├── version_info.txt           # Windows PE resource metadata
│   └── tests/                     # 53 Python unit, sandbox & security tests
├── apps/
│   └── web/                       # React 19 + TypeScript Web Console
│       ├── server.ts              # Express API & WoL dispatcher server
│       ├── vite.config.ts         # Vite bundler configuration
│       ├── src/                   # React components, state stores & styling
│       └── tests/                 # Pillar verification & stress test suites
├── public/releases/               # Distribution binaries, checksums & manifests
│   ├── v3.1.0-beta.1/             # Current public beta artifacts
│   └── v3.0.0/                    # Previous beta artifacts
├── scripts/                       # Build and release automation scripts
│   ├── build_android_app.py       # Standalone APK compiler and packager
│   └── publish_release_v310.py    # GitHub release publishing automation
├── CHANGELOG.md                   # Full version history
├── PATCH_NOTES.md                 # Detailed v3.1.0-beta.1 release notes
├── LICENSE                        # MIT License
└── package.json                   # Project metadata & npm scripts
```

---

## Keyboard Shortcuts

| Key | Action |
| :---: | :--- |
| `1` | Switch to **Fleet Dashboard** |
| `2` | Switch to **Command Terminal** |
| `3` | Switch to **AI Copilot** |
| `4` | Switch to **System Settings** |
| `Ctrl + K` or `/` | Open Host Search & Omnibar |
| `R` | Trigger network rescan |
| `Shift + ?` | Open Keyboard Shortcuts modal |
| `↑` / `↓` | Navigate terminal command history |

---

## License

Distributed under the [MIT License](LICENSE).
Copyright © 2026 CST Autonomous LAN Systems.

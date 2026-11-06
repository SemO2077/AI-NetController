# AI NetController (`v2.9.0-LTS`) — Complete Project & Operations Guide

> **Technical University of Varna (ТУ-Варна)** • Department of Computer Science and Technologies (КСТ)  
> **Architecture**: Zero-Trust Distributed Fleet Management, Wake-on-LAN, 120 FPS Screen Streaming & Agentic AI Diagnostics  
> **Languages Supported**: 100% Bilingual Parity (English `EN` / Bulgarian `BG`)  
> **Current Release**: `v2.9.0-LTS` *(Previous releases `v2.8.0`, `v2.7.1`, and `v2.7.0` remain available in the GitHub Releases tab)*

---

## Table of Contents

1. [What is AI NetController?](#1-what-is-cst-netcontroller-ai)
2. [How the 3-Tier Architecture Works](#2-how-the-3-tier-architecture-works)
3. [Quick-Start: Getting Everything Running in 3 Minutes](#3-quick-start-getting-everything-running-in-3-minutes)
4. [Complete Feature Guide](#4-complete-feature-guide)
   - [4.1 Fleet Dashboard & 3-Tile Bento Drawer](#41-fleet-dashboard--3-tile-bento-drawer)
   - [4.2 Native PC Daemon Control Center GUI (`agent_gui.py`)](#42-native-pc-daemon-control-center-gui-agent_guipy)
   - [4.3 Wake-on-LAN (WoL), SecureOn & Automated Cron Scheduler](#43-wake-on-lan-wol-secureon--automated-cron-scheduler)
   - [4.4 60–120 FPS Remote Screen Stream & OS Input Injection](#44-60120-fps-remote-screen-stream--os-input-injection)
   - [4.5 Interactive D3 LAN Topology Map & mDNS Zero-Config Discovery](#45-interactive-d3-lan-topology-map--mdns-zero-config-discovery)
   - [4.6 Multi-Host Command Terminal & AST Security Firewall](#46-multi-host-command-terminal--ast-security-firewall)
   - [4.7 Agentic AI Copilot & Host Memory Engine](#47-agentic-ai-copilot--host-memory-engine)
   - [4.8 Green WoL Energy & Financial Calculator](#48-green-wol-energy--financial-calculator)
5. [Important Things You Must Know (Critical Operational Guide)](#5-important-things-you-must-know-critical-operational-guide)
   - [5.1 Required Network Ports & Firewall Rules](#51-required-network-ports--firewall-rules)
   - [5.2 Hardware & OS Checklist for Wake-on-LAN (Why PCs Fail to Wake)](#52-hardware--os-checklist-for-wake-on-lan-why-pcs-fail-to-wake)
   - [5.3 Antivirus & Windows Defender: How False Positives Are Eliminated](#53-antivirus--windows-defender-how-false-positives-are-eliminated)
   - [5.4 Security Controls: View-Only Mode, HITL Gate & Panic Disconnect](#54-security-controls-view-only-mode-hitl-gate--panic-disconnect)
   - [5.5 Keyboard Shortcuts & Power-User Workflows](#55-keyboard-shortcuts--power-user-workflows)
6. [Building from Source & Verifying Releases](#6-building-from-source--verifying-releases)
7. [Troubleshooting FAQ](#7-troubleshooting-faq)

---

## 1. What is AI NetController?

**AI NetController** is an enterprise and university-lab remote fleet orchestrator built for system administrators, lab managers, and power users. It allows you to monitor, wake, control, diagnose, and automate dozens of Windows, Linux, and macOS workstations from a single glassmorphic web console or mobile phone.

Unlike traditional remote desktop tools that require heavy background services or cloud relays, AI NetController operates **100% locally on your LAN** with **Zero-Trust cryptographic framing (`AI-NET/3.0-SECURE`)** and optional **Agentic AI troubleshooting** powered by Gemini.

---

## 2. How the 3-Tier Architecture Works

The project is organized as a polyglot monorepo with three primary layers:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. CONTROLLER CLIENTS                                                       │
│    • Web Console & PWA (apps/web/) — React 19.3 + Vite + Express Backend    │
│    • Android / iOS Client (apps/mobile/) — Flutter 3.29 + Impeller Engine   │
└──────────────────────┬──────────────────────────────────┬───────────────────┘
                       │ REST / JSON (`/api/*`)           │ Binary WebSocket (`AI-NET/3.0-SECURE`)
                       ▼                                  ▼
┌──────────────────────────────────────┐   ┌──────────────────────────────────┐
│ 2. LOCAL ORCHESTRATION SERVER        │   │ 3. HOST PC DAEMON (`agent/`)     │
│    • Express API (`server.ts`)       │◄─►│    • Native Desktop GUI          │
│    • UDP Port 9 WoL Broadcaster      │   │      (`agent_gui.py` Tkinter)    │
│    • mDNS `_ai-netcontroller-agent._tcp.local.`   │   │    • Asyncio Telemetry & Screen  │
│    • AST Firewall (`v2026.10-REV5`)  │   │      Encoder (`agent_daemon.py`) │
└──────────────────────────────────────┘   └──────────────────────────────────┘
```

### Directory Breakdown
- **`apps/web/`**: The full-stack TypeScript web application.
  - `server.ts`: Node.js/Express backend handling UDP Wake-on-LAN socket dispatch, host quarantine, circuit-breaker tracking, AST command validation, and PC Daemon state synchronization (`/api/daemon/*`).
  - `src/`: React 19.3 frontend featuring a **3-Tier Optical Glass Design System**, interactive D3 network topology, Recharts telemetry/energy analytics, and bilingual `EN`/`BG` localization.
- **`agent/`**: The lightweight Python 3.12+ daemon that runs on the target PCs you want to monitor and control.
  - `agent.py`: Main entry point (launches the desktop GUI by default, or runs headless in server environments via `--headless`).
  - `agent_gui.py`: Native dark-slate Tkinter desktop GUI (`AI NetController Host Agent — Control Center`) giving the local PC user full visibility and control over incoming connections.
  - `agent_daemon.py`: Core `asyncio` engine handling CPU/RAM/Disk telemetry, 120 FPS screen capture (`mss`), Adler-32 4×4 dirty-tile delta compression, and `AI-NET/3.0-SECURE` binary packet framing.
- **`apps/mobile/`**: The native Flutter 3.29 mobile client (`AI_NetController_v2.9.0_arm64-v8a.apk`) with hardware-accelerated Impeller rendering, biometric auth gate, and tactile remote trackpad controls.

---

## 3. Quick-Start: Getting Everything Running in 3 Minutes

### Step 1: Launch the Web Console
From the repository root:
```bash
npm install
npm run dev
```
Open **`http://localhost:3000`** in your browser.

### Step 2: Run the Host Agent Daemon on Target PC(s)
You have two ways to run the daemon on a target workstation:

- **Option A — Standalone Windows Executable (Zero Python install required):**
  Download **`AI_NetController_HostAgent_v2.9.0_win64.exe`** directly from the top navigation bar in the Web Console (click the **`PC Daemon`** or **`Download .EXE`** button) and launch it.
- **Option B — From Python Source (Windows / Linux / macOS):**
  ```bash
  pip install psutil
  python agent/agent.py
  ```
  *(Use `python agent/agent.py --headless` on headless Linux servers without an X11/Wayland display).*

### Step 3: Pair or Auto-Discover
1. When the **AI NetController Host Agent — Control Center** window opens on the PC, it displays:
   - **WebSocket Endpoint**: e.g., `ws://192.168.1.42:8765`
   - **Pairing Token**: e.g., `CST-9F4A-82B1`
2. If your Web Console is on the same LAN subnet and **mDNS Auto-Discovery** is enabled, the host appears automatically within 5 seconds.
3. Otherwise, click **`+ Add`** in the Fleet Dashboard, enter the host's IP address, MAC address, and Pairing Token (or click **`Copy Pairing URI`** in the PC Daemon GUI).

---

## 4. Complete Feature Guide

### 4.1 Fleet Dashboard & 3-Tile Bento Drawer
The **Fleet Dashboard** (`Tab 1`) gives you an immediate health overview of all workstations:
- **Live Header Capsule**: Displays online vs. sleeping host counts and a 1-tap **`⚡ Wake All (N)`** button whenever any workstation is offline.
- **Pinning & Filtering**: Pin critical servers to the top of the grid (`📌`), filter by status (`All`, `Online`, `Sleeping`, `Servers`), sort by Name, CPU, RAM, or Latency, and search by hostname, IP, or MAC (`⌘K` or `/`).
- **Sleeping Host Honesty**: Offline machines never display stale or fake CPU/RAM numbers—they cleanly indicate **`Sleeping • Ready for Wake-on-LAN`** with a prominent **`⚡ Wake Host`** button.
- **3-Tile Bento Drawer** (click any online host card to expand):
  1. **Tile 1 — Live Interactive Mini-Preview (16:9)**: Real-time screen preview with a `● LIVE` indicator and **`⤢ Open Fullscreen & Trackpad`** button.
  2. **Tile 2 — 1-Tap Quick OS Actions**: Four tactile sysadmin buttons that execute without typing commands:
     - `🔄 Check Updates` (`winget upgrade` / `apt list --upgradable`)
     - `🧹 Flush DNS & Temp` (`ipconfig /flushdns` & temp cleanup)
     - `🔒 Lock Screen` (immediately locks the remote workstation desktop)
     - `⚠️ Restart Host` (graceful OS reboot with confirmation)
  3. **Tile 3 — Compact Diagnostics & Copyable Identity**: 1-tap copyable MAC & IP badges, Disk usage bar, OS kernel version, and an inline RTT latency sparkline with jitter (`±ms`).

---

### 4.2 Native PC Daemon Control Center GUI (`agent_gui.py`)
Every workstation running the daemon has a clean, lightweight **Native Desktop GUI** (and you can also preview and control it remotely via the **`PC Daemon`** button in the Web Console header):
- **4 Live Metric Cards**: Real-time **CPU Load %**, **RAM Allocation %**, **System Uptime**, and **Active Remote Sessions**.
- **Connection & Pairing Card**: Displays the local IP, MAC address, `ws://<ip>:8765` endpoint, and **Pairing Token** with 1-click **`Copy Pairing URI`** and **`Rotate Token`** buttons.
- **Quick Controls & Security Guardrails**:
  - **Pause / Resume Daemon**: Temporarily suspend incoming remote connections without closing the app.
  - **View-Only Mode (Input Lock)**: Allows remote administrators to view the screen and telemetry while blocking all remote mouse, keyboard, and shell injection.
  - **Require HITL Approval**: Forces a confirmation prompt on the host PC before any high-risk remote command is executed.
  - **mDNS Broadcast Toggle**: Controls whether the PC announces itself on `_ai-netcontroller-agent._tcp.local.`.
  - **Panic Disconnect All**: Immediately severs all active WebSocket sessions and rotates the session nonce.
- **NIC & Wake-on-LAN Readiness Diagnostics**: Inspects physical network adapters (`Ethernet`, `Wi-Fi`), verifies link speed and IPv4 binding, and reports whether `Wake on Magic Packet` is ready.

---

### 4.3 Wake-on-LAN (WoL), SecureOn & Automated Cron Scheduler
Click **`Wake-on-LAN`** on any host or open the WoL Modal:
- **IEEE 802.3 102-Byte Magic Packets**: Sends `6 × 0xFF` synchronization bytes followed by `16 × 6-byte MAC repetitions` over UDP broadcast port `9` (or port `7`).
- **RFC 5494 108-Byte SecureOn Support**: Optional 6-byte hex password (`AA:BB:CC:DD:EE:FF`) appended to the Magic Packet for NICs with hardware BIOS SecureOn locks.
- **Automated Wake Scheduler**: Set recurring wake schedules (e.g., `07:30 AM` Mon–Fri for Computer Lab 402 before morning lectures) with 1-tap toggle switches.

---

### 4.4 60–120 FPS Remote Screen Stream & OS Input Injection
Clicking **`⤢ Open Fullscreen & Trackpad`** opens the high-framerate Remote Screen Modal:
- **Adler-32 4×4 Spatial Delta Encoding**: Instead of re-encoding the entire monitor on every frame, the daemon divides the screen into a 4×4 grid (`16` tiles) and computes a fast Adler-32 checksum per tile. Only modified tiles are transmitted, cutting LAN bandwidth by up to 82%.
- **Aspect-Ratio & Zoom Solver**: Switch between `Fit`, `16:9`, `16:10`, `21:9`, `4:3`, and `Fill`, plus interactive zoom (`50%` to `300%`) and target FPS caps (`30`, `60`, `120 FPS`).
- **Quick Remote OS Keybar**: Send special system key combinations that browsers normally intercept: **`Ctrl+Alt+Del`**, **`Win`**, **`Alt+Tab`**, **`TaskMgr` (`Ctrl+Shift+Esc`)**, and **`Esc`**.

---

### 4.5 Interactive D3 LAN Topology Map & mDNS Zero-Config Discovery
Switch the Fleet Dashboard from **`Cards`** to **`Map`** view:
- Renders an interactive **D3 Force-Directed Graph** with the central CST Gateway node connected to all discovered hosts.
- Link colors and pulse speeds dynamically reflect real-time RTT latency (`<15ms` Emerald, `15–50ms` Cyan, `>50ms` Amber, `Offline` Slate dashed).
- Click any node on the canvas to inspect its telemetry or wake it directly from the topology view.

---

### 4.6 Multi-Host Command Terminal & AST Security Firewall
The **Console** (`Tab 2`) provides a multi-host PowerShell / Bash execution environment:
- **Target Addressing**: Run commands on a single host (`Unicast`), a lab group (`Group`), or every online machine simultaneously (`Broadcast`).
- **1-Tap Bilingual Presets**: Instant buttons for `Flush DNS`, `Active Ports`, `Top Processes`, and `Disk Health`.
- **Command History**: Use `↑` and `↓` arrow keys inside the terminal input to cycle through previously executed commands.
- **AST Security Firewall (`v2026.10-REV5`)**: Every command is parsed before transmission:
  - **Blocked (Destructive)**: Commands like `rm -rf /`, `format`, `del /f /s /q C:\`, fork bombs, or raw disk overwrites (`dd if=/dev/zero`) are hard-blocked at the gateway.
  - **High-Risk (HITL Intercepted)**: Commands like `shutdown`, `restart-computer`, `stop-service`, or firewall changes trigger an interactive **Human-in-the-Loop (HITL) Approval Modal** displaying a 0–100 Risk Score and cryptographic audit hash before execution.

---

### 4.7 Agentic AI Copilot & Host Memory Engine
The **AI Assistant** (`Tab 3`) integrates **Gemini (`gemini-3-flash-preview`)** with live fleet context:
- **Context-Aware Diagnostics**: Ask *"Why is LAB-PC-04 experiencing high latency?"* or *"Generate a PowerShell script to clear temp shader caches across all online hosts"*.
- **Per-Host Memory Engine** (click the **`Memory`** button in the AI header): Store persistent architectural facts, custom security rules, or hardware quirks per workstation (e.g., *"LAB-GPU-02 has dual RTX 4090s; never restart during CUDA jobs"*). These rules are automatically injected into the AI's system prompt.

---

### 4.8 Green WoL Energy & Financial Calculator
Located in **Settings** (`Tab 4`) as a collapsible executive summary banner:
- Calculates annual kWh and financial savings (`BGN` / `EUR`) achieved by putting lab workstations to sleep after hours and waking them on-demand via Wake-on-LAN instead of leaving them idling 24/7.
- Includes presets for **University Lab (30 PCs)**, **Home Studio (3 PCs)**, and **Enterprise Floor (120 PCs)** with a localized weekly Recharts comparison graph.

---

## 5. Important Things You Must Know (Critical Operational Guide)

### 5.1 Required Network Ports & Firewall Rules
Ensure the following ports are allowed on your local LAN / Windows Defender Firewall:

| Port | Protocol | Direction | Purpose |
| :--- | :---: | :---: | :--- |
| **`3000`** | TCP | Inbound to Server | Web Console UI & REST API (`apps/web/server.ts`) |
| **`8765`** | TCP | Inbound to Host PC | Host Agent `AI-NET/3.0-SECURE` WebSocket Telemetry & Screen Stream |
| **`9`** *(or `7`)* | UDP | Broadcast (`255.255.255.255`) | IEEE 802.3 Wake-on-LAN Magic Packet dispatch |
| **`5353`** | UDP | Multicast (`224.0.0.251`) | RFC 6762 mDNS Zero-Config Host Auto-Discovery |

> **Tip for Windows Host PCs**: Run this single PowerShell command (as Administrator) on target PCs to open the Agent WebSocket port on your Private/Domain LAN:
> ```powershell
> New-NetFirewallRule -DisplayName "AI NetController Host Agent Daemon (TCP 8765)" -Direction Inbound -LocalPort 8765 -Protocol TCP -Action Allow -Profile Private,Domain
> ```

---

### 5.2 Hardware & OS Checklist for Wake-on-LAN (Why PCs Fail to Wake)
Wake-on-LAN works at **Layer 2 (Data Link Layer)** before the operating system even boots. If clicking **`Wake Host`** sends the UDP packet (`200 OK`) but the physical PC stays off, check these **4 mandatory settings** on the target PC:

1. **Ethernet Cable Required**: Standard Wake-on-LAN requires a wired **RJ45 Ethernet** connection (most Wi-Fi cards power down their radio in `S5` shutdown state).
2. **BIOS / UEFI Power Management**:
   - Enter BIOS (`Del` or `F2` at boot) → **Advanced** → **APM / Power Management**.
   - Enable **`Power On By PCI-E / LAN`** (or **`Wake on LAN`**).
   - Disable **`ErP Ready` / `Deep Sleep`** (if ErP is enabled, the motherboard cuts 5V standby power to the Ethernet port when shut down).
3. **Windows Network Adapter Driver Settings**:
   - Open **Device Manager (`devmgmt.msc`)** → **Network adapters** → Right-click your Ethernet controller → **Properties**.
   - Under the **Advanced** tab: Set **`Wake on Magic Packet`** to **Enabled**.
   - Under the **Power Management** tab: Check **`Allow this device to wake the computer`** and **`Only allow a magic packet to wake the computer`**.
4. **Disable Windows "Fast Startup" (Most Common Gotcha!)**:
   - Windows 10/11 "Fast Startup" puts the kernel into a hybrid hibernation state (`S4`) where many Realtek and Intel NIC drivers ignore Magic Packets.
   - Run `powercfg.cpl` → **Choose what the power buttons do** → Uncheck **`Turn on fast startup`**, or run in an Administrator PowerShell:
     ```powershell
     reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f
     ```

---

### 5.3 Antivirus & Windows Defender: How False Positives Are Eliminated
Unsigned Python-to-EXE binaries are frequently flagged by Windows Defender or Malwarebytes heuristics if they look like "silent background implants." **AI NetController Host Agent (`v2.8.0-LTS`)** is specifically engineered to pass static and behavioral antivirus inspection cleanly:

1. **Zero UPX Compression (`upx=False`)**: UPX-packed executables share section entropy signatures (`UPX0`/`UPX1`) with malware packers. Our `agent/build_agent.spec` explicitly disables UPX compression so all PE sections remain uncompressed and transparent to Windows Defender.
2. **Visible Desktop Window (`HWND`) & System Tray**: Background-only executables with no visible window (`console=False` without a GUI) trigger behavioral heuristics when capturing screens or opening sockets. Launching the visible **AI NetController Host Agent — Control Center** Tkinter GUI establishes a legitimate foreground user application context.
3. **Zero Hidden Shell Subprocesses on Startup**: Instead of spawning hidden `powershell.exe -WindowStyle Hidden` or `cmd.exe /c` subprocesses to read network adapters or clipboard state (which triggers EDR "Living-off-the-Land" alerts), `agent_gui.py` uses pure Python `psutil.net_if_addrs()`, `psutil.net_if_stats()`, and native Tkinter clipboard APIs.
4. **Embedded Windows PE Version Metadata & UAC `asInvoker` Manifest**: The binary embeds official company metadata (`Technical University of Varna — CST Dept`), product version (`2.9.0.0`), and `requestedExecutionLevel level="asInvoker"` so it never demands suspicious privilege escalation on launch.
5. **SHA-256 Authenticode Code Signing (`agent/sign_binary.ps1`)**:
   - Digitally signed with Authenticode certificate `CN=AI NetController, O=AI_NetController, C=BG`.
   - To eliminate Windows SmartScreen "Unknown Publisher" prompts across university lab PCs, sign the `.exe` using `agent/sign_binary.ps1` and import the public certificate into each lab machine's `Cert:\LocalMachine\Root` store:
     ```powershell
     powershell -ExecutionPolicy Bypass -File agent\sign_binary.ps1 -ExePath public\releases\v2.8.0\AI_NetController_HostAgent_v2.9.0_win64.exe
     ```

---

### 5.4 Security Controls: View-Only Mode, HITL Gate & Panic Disconnect
- **Cryptographic Packet Framing (`AI-NET/3.0-SECURE`)**: Every WebSocket frame starts with the magic header `0xC5 0x71`, protocol version `0x30`, an **RFC 6479 128-bit sliding-window anti-replay sequence number**, and a **ChaCha20-Poly1305 16-byte AEAD authentication tag**. Replayed or tampered packets are dropped in `<0.2ms`.
- **Host Quarantine & Circuit Breaker**: Any workstation can be quarantined with 1 click (`🔒 Quarantine`) if suspicious activity is detected, immediately blocking all outbound commands and screen streams to that node.
- **Local User Sovereignty**: The person sitting in front of the physical PC always has ultimate authority via the **PC Daemon Control Center GUI**—they can enable **View-Only Mode**, require **Local HITL Approval**, **Rotate the Pairing Token**, or click **Panic Disconnect All** at any moment.

---

### 5.5 Keyboard Shortcuts & Power-User Workflows
When working in the Web Console (outside of text inputs), use these global hotkeys:

| Shortcut | Action |
| :---: | :--- |
| **`1`** | Switch to **Fleet Dashboard** |
| **`2`** | Switch to **Multi-Host Command Console** |
| **`3`** | Switch to **Agentic AI Copilot** |
| **`4`** | Switch to **System Settings & Energy Calculator** |
| **`⌘K`** or **`/`** | Focus the **Fleet Search & Filter Bar** |
| **`R`** | Trigger an immediate **Fleet Telemetry & mDNS Refresh** |
| **`Shift + ?`** | Open the interactive **Keyboard Shortcuts Cheat Sheet** |
| **`↑` / `↓`** | Cycle through **Command History** inside the Terminal input |

---

## 6. Building from Source & Verifying Releases

Pre-compiled release binaries are served directly from the web app under `/releases/v2.9.0/` (with `/releases/v2.7.1/` and `/releases/v2.7.0/` also permanently preserved) and can be downloaded from the top navigation bar or **Settings → Native Release Downloads**:

### Latest Release (`v2.8.0-LTS`)

| Artifact | Target Platform | Size | SHA-256 Checksum |
| :--- | :--- | :---: | :--- |
| **`AI_NetController_HostAgent_v2.9.0_win64.exe`** | Windows 10/11 (`x86_64` PE32+ Signed `O=AI_NetController`) | 35.3 MB | `657a2ffe752c3e8a52c2684423e6f270daff71b50ab9fcbb1a754e3156a67403` |
| **`AI_NetController_v2.9.0_arm64-v8a.apk`** | Android 10–15 (`arm64-v8a` High-Refresh 120Hz) | 21.8 MB | `1280ded4104225baadf68ecfb3f627d42871b6d9488a9513e37e786776708c2a` |
| **`AI_NetController_v2.8.0.apk`** | Android 10–15 (Universal Package) | 21.8 MB | `1280ded4104225baadf68ecfb3f627d42871b6d9488a9513e37e786776708c2a` |
| **`AI_NetController_HostAgent_v2.8.0_win64_portable.zip`** | Windows Portable Agent Bundle + Internal Runtime | 34.7 MB | `f4d239a1d04222695129d7e1a61c355bab9d2b76bdcd763ecd8df4e16a64e35c` |

### Previous Releases (`v2.7.1-LTS` & `v2.7.0-LTS`) — Still Available

| Artifact | Target Platform | Size | SHA-256 Checksum |
| :--- | :--- | :---: | :--- |
| **`AI_NetController_HostAgent_v2.7.1_win64.exe`** | Windows 10/11 (`x86_64` PE32+ Signed `O=AI_NetController`) | 35.3 MB | `fb64a8f8d609fccf37582e78914c810ee488b78d28ffb6d49602c6b851d4f90f` |
| **`AI_NetController_v2.7.1_arm64-v8a.apk`** | Android 10–15 (`arm64-v8a` High-Refresh 120Hz) | 22.8 MB | `54dcabd909c03bb282c9fa28f2c8c95a2378491c49c30ac9b157399016b89751` |
| **`AI_NetController_HostAgent_v2.7.0_win64.exe`** | Windows 10/11 (`x86_64` PE32+ Signed) | 33.7 MB | `484467fccf3c2605a1ce180420db437707a80c095526404473d591b415b55c89` |
| **`AI_NetController_v2.7.0_arm64-v8a.apk`** | Android 10–15 (`arm64-v8a` 120Hz) | 22.5 MB | `b0be786f11ef95b46322bf9da8b93e4664fb8504e525fd682da8be310e95abb6` |

- **To rebuild the Windows `.EXE` from source**: Run `pyinstaller --clean build_agent.spec` inside `agent/` and sign via `powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -ExePath dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe`.
- **To rebuild the Android `.APK` from source**: Run `flutter build apk --release --split-per-abi` inside `apps/mobile/`.
- See **[docs/COMPILATION_GUIDE.md](./COMPILATION_GUIDE.md)** and **[docs/SETUP_GUIDE.md](./SETUP_GUIDE.md)** for full step-by-step instructions.

---

## 7. Troubleshooting FAQ

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **Host shows `Sleeping` even though the PC is turned on** | Daemon is not running on the PC or port `8765` is blocked by Windows Firewall. | Launch `AI_NetController_HostAgent_v2.9.0_win64.exe` (or `v2.7.1` / `v2.7.0`, or `python agent/agent.py`) on the PC and allow TCP port `8765` on your Private LAN firewall profile. |
| **Clicking `Wake Host` succeeds (`UDP Port 9 Dispatched`) but PC does not power on** | BIOS `Wake on PCI-E/LAN` is disabled, or Windows `Fast Startup` is intercepting the NIC shutdown state. | Follow the 4 steps in [Section 5.2](#52-hardware--os-checklist-for-wake-on-lan-why-pcs-fail-to-wake) (especially disabling Windows Fast Startup via `HiberbootEnabled=0`). |
| **Remote mouse/keyboard clicks do not move the cursor on the target PC** | **View-Only Mode (Input Lock)** is enabled on the target PC's Daemon Control Center. | Uncheck **`View-Only Mode (Block Remote Mouse/Keyboard)`** in the PC Daemon GUI or inside the Web Console's `PC Daemon` modal. |
| **Command execution is blocked with `SECURITY POLICY VIOLATION`** | The command matched a destructive pattern in the **AST Security Firewall (`v2026.10-REV5`)**, or the host is currently **Quarantined**. | Inspect the command syntax or un-quarantine the host in the Fleet Dashboard (`Unlock Host`). |
| **AI Copilot returns an offline fallback diagnostic** | `GEMINI_API_KEY` is not set in the server environment. | Configure `GEMINI_API_KEY` in `.env` (see `.env.example`). When offline, the built-in heuristic diagnostic engine automatically provides local troubleshooting guidance. |

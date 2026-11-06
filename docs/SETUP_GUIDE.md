# AI NetController — Comprehensive Setup & Deployment Guide

**Version:** `v2.9.0-LTS`  
**Protocol:** `AI-NET/3.0-SECURE`  
**Target Environments:** Windows 10/11 (Host Agent), Android 10–15 (Mobile Client), Linux / macOS (Web Console & Headless Agent)

---

## Table of Contents

1. [Hardware & Network Architecture Requirements](#1-hardware--network-architecture-requirements)
2. [Target Windows PC Setup (Host Agent Daemon)](#2-target-windows-pc-setup-host-agent-daemon)
   - [Method A: Standalone Executable (Zero-Install)](#method-a-standalone-executable-zero-install)
   - [Method B: Running from Python 3.12 Source](#method-b-running-from-python-312-source)
   - [Windows Startup & Auto-Launch Service](#windows-startup--auto-launch-service)
   - [Windows Firewall Configuration](#windows-firewall-configuration)
   - [Wake-on-LAN (WoL) BIOS & OS Configuration](#wake-on-lan-wol-bios--os-configuration)
   - [Windows SmartScreen & Authenticode Certificate Trust](#windows-smartscreen--authenticode-certificate-trust)
3. [Target Linux / macOS Host Setup](#3-target-linux--macos-host-setup)
   - [Python Virtual Environment Setup](#python-virtual-environment-setup)
   - [Headless Systemd Service Configuration](#headless-systemd-service-configuration)
   - [Linux Wake-on-LAN (ethtool) Configuration](#linux-wake-on-lan-ethtool-configuration)
4. [Web Management Console Setup](#4-web-management-console-setup)
   - [Prerequisites](#prerequisites)
   - [Environment Variables (.env)](#environment-variables-env)
   - [Development Mode](#development-mode)
   - [Production Build & Process Management (PM2)](#production-build--process-management-pm2)
5. [Android Mobile Client Setup](#5-android-mobile-client-setup)
   - [Installing the Pre-Compiled APK](#installing-the-pre-compiled-apk)
   - [120Hz Display Verification & Optimization](#120hz-display-verification--optimization)
   - [mDNS Auto-Discovery & Pairing](#mdns-auto-discovery--pairing)
6. [Security & Operational Best Practices](#6-security--operational-best-practices)
   - [Pairing Token Lifecycle](#pairing-token-lifecycle)
   - [View-Only Mode & Local HITL Gates](#view-only-mode--local-hitl-gates)
   - [AST Command Firewall Customization](#ast-command-firewall-customization)
7. [Comprehensive Troubleshooting Matrix](#7-comprehensive-troubleshooting-matrix)

---

## 1. Hardware & Network Architecture Requirements

### Network Architecture
AI NetController operates on an autonomous **Zero-Trust Local Area Network (LAN)**:
- **No external cloud dependency required**: Screen streaming, telemetry, and command execution function 100% offline.
- **Optional Internet Access**: Only required if using Google Gemini AI Copilot for natural language diagnostics.

### Required Network Ports
| Port | Protocol | Direction | Description |
| :--- | :---: | :---: | :--- |
| **`3000`** | TCP | Inbound | Web Console UI & REST/WebSocket API |
| **`8765`** | TCP | Inbound | Host Agent WebSocket (`AI-NET/3.0-SECURE`) |
| **`9` / `7`** | UDP | Outbound / Broadcast | Wake-on-LAN IEEE 802.3 Magic Packet |
| **`5353`** | UDP | Multicast | mDNS Zero-Config Discovery (`_ai-netcontroller-agent._tcp.local.`) |

---

## 2. Target Windows PC Setup (Host Agent Daemon)

### Method A: Standalone Executable (Zero-Install)
The standalone executable bundle requires **no Python installation**, no external compilers, and no admin privileges to run.

1. Download **[`AI_NetController_HostAgent_v2.9.0_win64.exe`](https://github.com/smehmedd/AI-NetController/releases/download/v2.9.0/AI_NetController_HostAgent_v2.9.0_win64.exe)**.
2. Place it in a dedicated directory (e.g. `C:\Tools\AI_NetController_HostAgent\`).
3. Double-click the file to launch.
4. The **AI NetController Host Agent — Control Center** dark-slate window will appear on the desktop and register an icon in the Windows Notification Area (System Tray).
5. The window displays:
   - **Local IPv4 & Hostname**
   - **WebSocket URI**: e.g., `ws://192.168.1.100:8765`
   - **Pairing Key**: e.g., `CST-9A82-4F10` (Click **Copy Token** or **Rotate Token**).

### Method B: Running from Python 3.12 Source
For development or customized deployments:

1. Ensure Python 3.11 or 3.12 is installed with `pip`:
   ```powershell
   python --version
   ```
2. Navigate to the `agent/` directory:
   ```powershell
   cd agent
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Run the interactive Control Center GUI:
   ```powershell
   python agent.py
   ```
4. Or run headless in the background:
   ```powershell
   python agent.py --headless --port 8765
   ```

### Windows Startup & Auto-Launch Service
To ensure the Host Agent starts automatically when Windows boots:

#### Option 1: User Startup Folder
1. Press `Win + R`, type `shell:startup`, and press Enter.
2. Create a shortcut to `AI_NetController_HostAgent_v2.9.0_win64.exe` inside this folder.

#### Option 2: Windows Task Scheduler (Runs at Boot without Login)
Run PowerShell as Administrator:
```powershell
$action = New-ScheduledTaskAction -Execute "C:\Tools\AI_NetController_HostAgent\AI_NetController_HostAgent_v2.9.0_win64.exe" -Argument "--headless"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "AI_NetController_HostAgent_Daemon" -Action $action -Trigger $trigger -Principal $principal
```

### Windows Firewall Configuration
If Windows Defender Firewall prompts to allow network access, select **Private Networks**.

To manually create inbound firewall rules via Administrator PowerShell:
```powershell
# Allow TCP Port 8765 (Agent WebSocket Listener)
New-NetFirewallRule -DisplayName "AI NetController Host Agent Daemon (TCP 8765)" `
    -Direction Inbound `
    -LocalPort 8765 `
    -Protocol TCP `
    -Action Allow `
    -Profile Private,Domain

# Allow UDP Port 5353 (mDNS Discovery)
New-NetFirewallRule -DisplayName "AI NetController Host Agent mDNS (UDP 5353)" `
    -Direction Inbound `
    -LocalPort 5353 `
    -Protocol UDP `
    -Action Allow `
    -Profile Private,Domain
```

### Wake-on-LAN (WoL) BIOS & OS Configuration
For remote wake to function reliably when the workstation is powered down, all four configuration steps must be performed:

1. **Physical Cable**: Target PC must be connected via wired **RJ45 Ethernet**.
2. **Motherboard BIOS/UEFI**:
   - Reboot PC, enter BIOS (`F2` or `Del`).
   - Go to **Power Management** / **Advanced Power Options**.
   - Set **`Power On By PCI-E / LAN`** to **Enabled**.
   - Set **`ErP Ready`** to **Disabled** (if enabled, the motherboard cuts the 5V standby rail to the Ethernet controller).
3. **Windows Device Manager**:
   - Open `devmgmt.msc` → Expand **Network adapters** → Right-click Ethernet NIC → **Properties**.
   - In **Advanced** tab: Set **`Wake on Magic Packet`** to **Enabled**.
   - In **Power Management** tab: Check **`Allow this device to wake the computer`** and **`Only allow a magic packet to wake the computer`**.
4. **Disable Windows "Fast Startup"**:
   Fast Startup puts Windows into a hybrid kernel hibernation state (`S4`) that prevents many network cards from listening for Magic Packets.
   Run in Administrator PowerShell:
   ```powershell
   reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f
   ```

### Windows SmartScreen & Authenticode Certificate Trust
The binary is signed with Authenticode certificate `O=AI_NetController`. To import this certificate into the Windows Root Certificate Authority store on managed domain/lab machines, run:
```powershell
powershell -ExecutionPolicy Bypass -File agent\sign_binary.ps1 -ExePath public\releases\v2.9.0\AI_NetController_HostAgent_v2.9.0_win64.exe
```

---

## 3. Target Linux / macOS Host Setup

### Python Virtual Environment Setup
```bash
# 1. Clone repository or copy agent/ folder
git clone https://github.com/smehmedd/AI-NetController.git
cd AI-NetController/agent

# 2. Setup virtual environment
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Headless Systemd Service Configuration
On Linux servers or lab machines, configure the daemon as a systemd service:

Create `/etc/systemd/system/ai-netcontroller-agent.service`:
```ini
[Unit]
Description=AI NetController Host Agent Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ai-netcontroller-agent
ExecStart=/opt/ai-netcontroller-agent/venv/bin/python /opt/ai-netcontroller-agent/agent.py --headless --port 8765
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ai-netcontroller-agent
sudo systemctl start ai-netcontroller-agent
sudo systemctl status ai-netcontroller-agent
```

### Linux Wake-on-LAN (ethtool) Configuration
Verify network interface name via `ip link`:
```bash
# Install ethtool
sudo apt-get install -y ethtool

# Enable Wake-on-LAN on eth0
sudo ethtool -s eth0 wol g
```

Persist across reboots by creating `/etc/network/interfaces` entry or via systemd link:
```ini
# /etc/systemd/network/50-wired.link
[Match]
OriginalName=eth0

[Link]
WakeOnLan=magic
```

---

## 4. Web Management Console Setup

### Prerequisites
- **Node.js**: v20.x or v22.x LTS
- **npm**: v10.x+

### Environment Variables (.env)
From repository root:
```bash
cp .env.example .env
```

Key environment configuration variables:
```env
# Server Port
PORT=3000
NODE_ENV=production

# Google Gemini API Key (Optional for AI Copilot natural language triage)
GEMINI_API_KEY=AIzaSy...

# Optional: Default target daemon port override
AI_DAEMON_PORT=8765
```

### Development Mode
```bash
# Install dependencies
npm install

# Start Vite React frontend and Express backend concurrently
npm run dev
```
Navigate to **`http://localhost:3000`** in any web browser.

### Production Build & Process Management (PM2)
```bash
# 1. Build optimized React bundle and compile TypeScript server
npm run build

# 2. Run verification test suite to ensure zero regressions
npm test

# 3. Start with PM2 Process Manager for 24/7 uptime
npm install -g pm2
pm2 start dist/server.js --name "ai-netcontroller-web-console"
pm2 save
pm2 startup
```

---

## 5. Android Mobile Client Setup

### Installing the Pre-Compiled APK
1. Download **[`AI_NetController_v2.9.0_arm64-v8a.apk`](https://github.com/smehmedd/AI-NetController/releases/download/v2.9.0/AI_NetController_v2.9.0_arm64-v8a.apk)** on your smartphone (or previous releases [`v2.8.0`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.8.0), [`v2.7.1`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.7.1), [`v2.7.0`](https://github.com/smehmedd/AI-NetController/releases/tag/v2.7.0)).
2. Open the downloaded file. When prompted, permit your browser to install unknown applications.
3. Tap **Install** and open **AI NetController**.

### 120Hz Display Verification & Optimization
The app includes native display mode switching:
- On high-refresh displays (120Hz/90Hz OLED or AMOLED), the application automatically detects supported modes via `display.supportedModes` and requests the maximum refresh rate.
- Frame drawing is decoupled via `_DoubleFrameRingBuffer` and `ValueNotifier<ui.Image?>`, ensuring zero jitter and sub-1.2ms frame-rendering times.

### mDNS Auto-Discovery & Pairing
1. Ensure your smartphone is connected to the same Wi-Fi network subnet as the target PC.
2. Open the AI NetController Mobile app. Within ~500ms, all active hosts running the daemon will appear in the **Fleet Discovery** list.
3. Tap a discovered host. Enter the **Pairing Token** shown in the PC Daemon GUI (`CST-XXXX-XXXX`) to complete authentication.

---

## 6. Security & Operational Best Practices

### Pairing Token Lifecycle
- Each daemon generates a unique pairing token on startup.
- Tokens can be rotated at any time directly from the physical desktop GUI (**`Rotate Token`**) or through the Web Console.
- When a token is rotated, all active sessions are instantly terminated, requiring re-authentication.

### View-Only Mode & Local HITL Gates
- **View-Only Mode**: In the PC Daemon GUI, check **`View-Only Mode`** to lock remote mouse clicks and keyboard typing while maintaining live screen stream and telemetry. Ideal for demonstrations or passive monitoring.
- **Human-in-the-Loop (HITL) Gate**: When enabled, any remote shell command execution prompts a physical dialog on the workstation screen requiring operator confirmation before execution.
- **Panic Disconnect All**: A single click on **`Panic Disconnect All`** instantly severs all active WebSocket controller connections and flushes cryptographic nonces.

### AST Command Firewall Customization
Commands executed through the Web Console or Mobile Controller pass through the Abstract Syntax Tree firewall in `agent/command_ast_firewall.py`.
- Blocks destructive commands: `format`, `rmdir /s`, `dd if=/dev/zero`, `mkfs`, recursive deletions.
- Neutralizes obfuscation: CMD carets (`c^a^t`), PowerShell backticks, substring slicing (`%VAR:~0,4%`), and nested quotes.

---

## 7. Comprehensive Troubleshooting Matrix

| Problem / Symptom | Probable Cause | Diagnostic & Resolution Steps |
| :--- | :--- | :--- |
| **PC shows "Offline" in Web Console** | Host Agent daemon not running or blocked by firewall. | Launch `AI_NetController_HostAgent_v2.9.0_win64.exe` (or `v2.7.1` / `v2.7.0`) on PC. Run `Test-NetConnection -ComputerName <ip> -Port 8765` from another machine to verify port. |
| **Wake-on-LAN packet sends (`200 OK`) but PC stays off** | BIOS `Power on PCI-E` disabled, or Windows Fast Startup enabled. | 1. Disable Windows Fast Startup (`HiberbootEnabled = 0`).<br>2. Enable `Power On By PCI-E` in BIOS.<br>3. Verify wired Ethernet is connected. |
| **Remote mouse/keyboard clicks do not register** | View-Only Mode is enabled. | In the PC Daemon GUI, uncheck **View-Only Mode (Block Remote Mouse/Keyboard)**. |
| **Mobile app does not discover PC** | mDNS multicast blocked by Wi-Fi AP client isolation. | Check Wi-Fi router settings: disable **AP Client Isolation** or connect mobile device to the same VLAN. Alternatively, enter PC IP manually. |
| **SmartScreen warns "Unknown Publisher"** | Self-signed Authenticode certificate not installed in Root store. | Run `powershell -ExecutionPolicy Bypass -File agent\sign_binary.ps1 -ExePath <path>` and import the generated certificate into `Cert:\LocalMachine\Root`. |
| **AI Copilot reports "Offline Diagnostic"** | `GEMINI_API_KEY` missing in `.env`. | Add your Gemini API key to `.env` (`GEMINI_API_KEY=AIzaSy...`) and restart the web server. |

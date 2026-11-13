# Setup Guide

This guide walks through setting up, configuring, and deploying **AI NetController** (`v0.51.0` / Beta `0.51.00`) on Windows, Linux/macOS, and Android devices.

---

## 1. System Requirements

| Component | Minimum Version | Recommended | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | v20.0.0+ | v20.x or v22.x LTS | Required for Express server and React dashboard |
| **npm** | v10.0.0+ | v10.x+ | Included with Node.js |
| **Python** | v3.11+ | v3.12+ | Required if running the Host Agent from source |
| **Operating System** | Windows 10/11 (64-bit) | Windows 11 x64 | Windows required for Job Object process isolation |
| **Android** | Android 10 (API 29) | Android 12–15 | Required for mobile companion app |
| **Ollama** | Optional | v0.3.0+ | Enables local offline LLM diagnostics (`http://localhost:11434`) |

---

## 2. Setting Up the Control Server & Web Dashboard

### Clone and Install

```bash
git clone https://github.com/SemO2077/AI-NetController.git
cd AI-NetController
npm install
```

### Environment Configuration

Create or edit `.env` in the repository root:

```ini
# HTTP listener port for the Web Console and REST API
PORT=3000

# (Optional) Pre-shared secret token for host-to-server authentication
# If omitted, an ephemeral secret token will be generated on boot
AI_AGENT_SECRET=your_secure_random_token_here

# (Optional) Google Gemini API key for cloud diagnostics
GEMINI_API_KEY=your_gemini_api_key_here

# (Optional) Endpoint for local LLM diagnostics (Ollama)
OLLAMA_HOST=http://localhost:11434
```

### Starting the Server

#### Development Mode (with Live Reload):
```bash
npm run dev
```

#### Production Build and Start:
```bash
npm run build
npm start
```

On Windows, you can also launch the server by double-clicking `START_HERE_WINDOWS.bat` (`./START_HERE_LINUX.sh` on Linux/macOS).

The Web Console will be accessible at:
```
http://localhost:3000
```

---

## 3. Setting Up the Windows Host Agent

The Windows Host Agent runs as a local daemon on port `8765`, streaming telemetry metrics and desktop frames, and executing sandboxed administrative commands.

### Option A: Standalone Executable (Recommended)

1. Download `AI_NetController_HostAgent_v0.51.0_win64.exe` from [GitHub Releases](https://github.com/SemO2077/AI-NetController/releases/tag/v0.51.0).
2. Execute the file to launch the **AI NetController Desktop Control Center GUI**.
3. The WebSocket server automatically begins listening on `ws://0.0.0.0:8765`.

### Option B: Run from Source

1. Open PowerShell or Command Prompt in the repository directory.
2. Install Python dependencies:
   ```bash
   pip install -r agent/requirements.txt
   ```
3. Start the agent:
   ```bash
   python agent/agent.py
   ```

### Host Agent Command-Line Flags

```bash
# Standard desktop GUI mode
python agent/agent.py

# Headless background service (no graphical interface)
python agent/agent.py --headless

# Install as Windows startup service and register desktop shortcut
python agent/agent.py --install

# Uninstall Windows autostart service and remove shortcuts
python agent/agent.py --uninstall

# Create Start Menu and Desktop shortcuts only
python agent/agent.py --create-shortcut

# Specify custom binding address and port
python agent/agent.py --host 192.168.1.50 --port 8765
```

### Host Agent Configuration

Configuration data is stored at:
```
%LOCALAPPDATA%\AI NetController\config.json
```

This file preserves:
- Paired client tokens and IP addresses
- Display capture frame rate and resolution preferences
- Autostart settings
- View-only mode and HITL (Human-in-the-Loop) enforcement flags

---

## 4. Pairing Controller with Host Agent

1. Open the Web Console at `http://localhost:3000`.
2. Navigate to **Settings** → **Pair Phone & PC** (or open the PC Daemon modal).
3. The host displays a pairing token and a QR code.
4. From the client (web or Android companion), enter the host IP (e.g., `192.168.1.50:8765`) and the pairing token.
5. The mutual HMAC-SHA256 handshake authenticates the connection, after which live telemetry and screen streaming commence.

---

## 5. Installing the Android Companion App

1. Download `AI_NetController_v0.51.0_arm64-v8a.apk` (or the universal `AI_NetController_v0.51.0.apk`) from [GitHub Releases](https://github.com/SemO2077/AI-NetController/releases/tag/v0.51.0).
2. Sideload the APK onto your Android device:
   ```bash
   adb install -r public/releases/v0.51.0/AI_NetController_v0.51.0_arm64-v8a.apk
   ```
3. Ensure the mobile device is connected to the same local Wi-Fi subnet as the Windows host.
4. Launch the application to scan for active host agents via mDNS or subnet ping sweeps.

---

## 6. Verification and Testing

Execute the test suites to verify that the environment is fully operational:

```bash
# Verify TypeScript compilation and linting
npm run lint

# Run the 14-pillar verification suite and 23 stress benchmarks
npm test

# Run the Python Host Agent unit and security test suite
python -m unittest discover -s agent/tests
```

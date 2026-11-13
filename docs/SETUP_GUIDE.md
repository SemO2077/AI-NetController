# Setup Guide

This guide covers configuring and running **AI NetController** (`v0.60.0` / Beta `0.60.00`) on Windows, Linux/macOS, and Android.

## 1. System Requirements

| Component | Minimum Version | Recommended | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | v20.0.0+ | v20.x or v22.x LTS | Control server (`apps/web/server.ts`) and React dashboard |
| **Python** | v3.11+ | v3.12+ | Host Agent daemon (`agent/agent.py`) |
| **Flutter** | v3.29+ (`Dart 3.7+`) | Latest stable | Optional: only required when building `apps/mobile/` from source |
| **Operating System** | Windows 10/11 x64 | Windows 11 x64 | Linux/macOS supported; Windows required for Job Object sandboxing & DPAPI config |
| **Android** | Android 10 (API 29) | Android 12–15 | Mobile companion runtime |
| **Ollama** | Optional | v0.3.0+ | Local LLM diagnostics (`http://127.0.0.1:11434`) |

## 2. Control Server & Web Console

### Clone & Install

From GitHub or the GitLab mirror:

```bash
git clone https://github.com/SemO2077/AI-NetController.git
# or: git clone https://gitlab.com/ryu-group7483245/ai-netcontroller.git
cd AI-NetController
npm install
```

### Environment Configuration

Copy `.env.example` to `.env` and adjust as needed:

```ini
# HTTP port for the web console and API (binds 127.0.0.1 by default)
PORT=3000

# Optional pre-shared secret; an ephemeral CSPRNG secret is generated when omitted
AI_AGENT_SECRET=your_secure_random_token_here

# Optional cloud diagnostics API key
GEMINI_API_KEY=your_gemini_api_key_here

# Optional local Ollama host
OLLAMA_HOST=http://localhost:11434
```

### Running the Server

Development mode:

```bash
npm run dev
```

Production build and start:

```bash
npm run build
npm start
```

Launcher scripts are also included in the root directory: `START_HERE_WINDOWS.bat` on Windows and `./START_HERE_LINUX.sh` on Linux/macOS. Once started, open `http://localhost:3000`.

## 3. Host Agent Daemon

The host daemon listens on WebSocket port `8765`, advertises via mDNS (`_cst-agent._tcp.local.`), streams adaptive JPEG desktop frames, reports system telemetry, and executes firewall-validated commands.

### Pre-Built Windows Binary

1. Download `AI_NetController_HostAgent_v0.60.0_win64.exe` (or the portable `.zip` archive) from [GitHub Releases](https://github.com/SemO2077/AI-NetController/releases/tag/v0.60.0).
2. Run the executable to open the desktop Control Center and tray service.

### Run from Source

```bash
pip install -r agent/requirements.txt
python agent/agent.py
```

Common CLI flags:

```bash
python agent/agent.py --headless          # Run without desktop GUI window
python agent/agent.py --install           # Register Windows startup entry and shortcut
python agent/agent.py --uninstall         # Remove startup entry and shortcut
python agent/agent.py --create-shortcut   # Create Desktop / Start Menu shortcut
python agent/agent.py --host 0.0.0.0 --port 8765
```

Configuration is persisted to `%LOCALAPPDATA%\AI NetController\config.json` (Windows) or `~/.ai_netcontroller/config.json` (Linux/macOS), with secrets DPAPI-sealed on Windows.

## 4. Client Pairing

1. Open the host Desktop Control Center (or the Web Console Quick Setup dialog).
2. View the host pairing token / 6-digit PIN (`15m` TTL) and QR code.
3. On Android or the Web Console, enter the host IP (`<host-ip>:8765`) and pair via PIN (`PAIR_INIT`/`PAIR_FINISH`) or token.

## 5. Android Companion App

1. Download `AI_NetController_v0.60.0_arm64-v8a.apk` (or the universal APK) from [GitHub Releases](https://github.com/SemO2077/AI-NetController/releases/tag/v0.60.0).
2. Install via ADB (`adb install -r AI_NetController_v0.60.0_arm64-v8a.apk`) or directly on device.
3. Connect the phone to the same LAN subnet to discover active hosts over mDNS (`_cst-agent._tcp.local.`).

## 6. Running Tests

```bash
npm run lint
npm test
python -m unittest discover -s agent/tests -v

# Flutter unit and live-daemon integration suite
cd apps/mobile
flutter analyze
flutter test test/
```

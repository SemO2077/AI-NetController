# Setup Guide

This guide walks through setting up and running **AI NetController** (`v0.35.0`) on Windows, Linux/macOS, and Android.

---

## 1. Prerequisites

| Component | Requirement | Notes |
| :--- | :--- | :--- |
| **Node.js** | v20.0+ | Required for the Express server and React dashboard |
| **Python** | v3.11+ | Required if running the Host Agent from source |
| **Ollama** | Optional | Enables local offline LLM diagnostics (`http://localhost:11434`) |

---

## 2. Running the Control Server & Web Dashboard

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/smehmedd/AI-NetController.git
   cd AI-NetController
   npm install
   ```

2. (Optional) Configure environment variables in `.env`:
   ```ini
   PORT=3000
   GEMINI_API_KEY=your_optional_api_key
   ```

3. Start the server (or double-click `START_HERE_WINDOWS.bat` on Windows):
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000` in your browser.

---

## 3. Running the Windows Host Agent

The Host Agent streams live system telemetry, 120 Hz desktop frames, and executes sandboxed remote administration commands on port `8765`.

### Option A: Prebuilt Executable (Recommended)
1. Download `AI_NetController_HostAgent_v0.35.0_win64.exe` from [GitHub Releases](https://github.com/smehmedd/AI-NetController/releases/tag/v0.35.0).
2. Launch the executable to open the native **AI NetController Desktop Control Center GUI** and start the WebSocket daemon on `ws://0.0.0.0:8765`.

### Option B: Run from Python Source
```bash
pip install -r agent/requirements.txt
python agent/agent.py
```
Pass `--headless` to run without the desktop GUI window.

---

## 4. Connecting the Android App

1. Download and install `AI_NetController_v0.35.0_arm64-v8a.apk` on your Android device.
2. Connect your phone to the same Wi-Fi / LAN network as your computer.
3. Open **AI NetController** on Android:
   - Tap **Scan LAN** or scan the QR code shown in the PC Quick Setup modal for instant zero-typing pairing.
   - You can also enter your PC's LAN IP address manually (e.g., `192.168.1.50:8765`).

---

## 5. Configuring Local AI (Ollama)

To use local AI diagnostics without external API keys:

1. Install [Ollama](https://ollama.com) and pull a model:
   ```bash
   ollama run deepseek-r1:latest
   ```
2. In the AI NetController dashboard, open **Settings -> AI Engine** and select **DeepSeek-R1 (Local / Ollama)**.

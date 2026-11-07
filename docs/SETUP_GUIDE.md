# Setup Guide

This guide walks through setting up and running **AI NetController** (`v0.32.0`) on Windows, Linux/macOS (dashboard server), and Android.

---

## 1. Prerequisites

| Component | Requirement | Notes |
| :--- | :--- | :--- |
| **Node.js** | v20.0+ | Required for the Express server and React dashboard |
| **Python** | v3.11+ | Required only if running the Host Agent from source |
| **Npcap / Wireshark** | Optional | Enables deep packet inspection (`scapy` / `tshark`) on Windows |
| **Ollama** | Optional | Enables local offline LLM diagnostics (`http://localhost:11434`) |

---

## 2. Running the Control Server & Web Dashboard

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/smehmedd/AI-NetController.git
   cd AI-NetController
   npm install
   ```

2. (Optional) Configure environment variables by copying `.env.example` to `.env`:
   ```ini
   PORT=3000
   GEMINI_API_KEY=your_optional_api_key
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000` in your browser.

---

## 3. Running the Windows Host Agent

The Host Agent collects system network metrics, Wi-Fi spectrum data, and per-process bandwidth usage, and applies Windows QoS policies.

### Option A: Prebuilt Executable (Recommended)
1. Download `AI_NetController_HostAgent_v0.32.0_win64.exe` from [GitHub Releases](https://github.com/smehmedd/AI-NetController/releases/tag/v0.32.0).
2. Right-click the executable and select **Run as administrator**.
3. The agent automatically connects to `http://localhost:3000` (or you can pass `--server http://<LAN_IP>:3000`).

### Option B: Run from Python Source
```bash
pip install -r requirements.txt
python agent/net_agent.py --server http://localhost:3000
```

---

## 4. Connecting the Android App

1. Download and install `AI_NetController_v0.32.0_arm64-v8a.apk` on your Android device.
2. Connect your phone to the same Wi-Fi / LAN network as the computer running the Control Server.
3. Open **AI NetController** on Android:
   - The app automatically scans the local subnet for an active server on port `3000`.
   - You can also enter your host PC's LAN IP address manually (e.g., `192.168.1.50:3000`) in the connection sheet.

---

## 5. Configuring Local AI (Ollama)

To use local AI diagnostics without external API keys:

1. Install [Ollama](https://ollama.com) and pull a model:
   ```bash
   ollama run llama3
   ```
2. In the AI NetController dashboard, open **Settings -> AI Engine** and select **Local (Ollama)**.

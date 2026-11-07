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
   git clone https://gitlab.com/ryu-group7483245/ai-netcontroller.git
   cd ai-netcontroller
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
1. Download `AI_NetController_HostAgent_v0.35.0_win64.exe` from [GitLab Releases](https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/v0.35.0).
2. Launch the executable to open the native **AI NetController Desktop Control Center GUI** and start the WebSocket daemon on `ws://0.0.0.0:8765`.

### Option B: Run from Python Source
```bash
pip install -r agent/requirements.txt
python agent/agent.py
```

---

## 4. Building Android Mobile Companion

```bash
# Compile native Android APK
python scripts/build_android_app.py
```

The APK will be generated at `public/releases/v0.35.0/AI_NetController_v0.35.0_arm64-v8a.apk`.

---

## 5. Testing & Verification

```bash
# TypeScript compiler & lint check
npm run lint

# Architecture & stress tests
npm test

# Python agent edge-case suite
python -m unittest discover -s agent/tests
```

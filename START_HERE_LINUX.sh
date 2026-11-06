#!/usr/bin/env bash
# CST NetController AI — 1-Click Linux Setup Launcher (v3.1.0-beta.3)
# ==============================================================================
set -e

echo "============================================================================"
echo "  CST NetController AI v3.1.0-beta.3 — 1-Click Linux Setup Launcher"
echo "============================================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/4] Checking Python 3 environment..."
if command -v python3 >/dev/null 2>&1; then
    if [ -f "agent/requirements.txt" ]; then
        echo "      Installing Python requirements..."
        python3 -m pip install -r agent/requirements.txt --quiet 2>/dev/null || true
    fi
else
    echo "[!] python3 not found. Please install Python 3.10+ (sudo apt install python3 python3-pip)."
fi

echo "[2/4] Verifying Linux firewall rules (Ports 8765, 3000, UDP 9)..."
if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow 8765/tcp comment 'CST NetController Daemon' 2>/dev/null || true
    sudo ufw allow 3000/tcp comment 'CST NetController Web' 2>/dev/null || true
    sudo ufw allow 9/udp comment 'CST NetController WoL' 2>/dev/null || true
fi

echo "[3/4] Launching CST Host Agent Daemon..."
if [ -f "agent/agent.py" ]; then
    python3 agent/agent.py &
    DAEMON_PID=$!
    echo "      Daemon started (PID: $DAEMON_PID)"
fi

echo "[4/4] Starting Web & Phone Controller Server on Port 3000..."
if [ ! -d "node_modules" ]; then
    echo "      Installing Node.js dependencies (first-time setup)..."
    npm install
fi

echo ""
echo "[READY] Opening Quick Setup & Phone QR Pairing Wizard..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:3000/?setup=1" 2>/dev/null || true
fi

npm run dev

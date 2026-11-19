#!/usr/bin/env bash
# AI NetController — Linux Setup Launcher (Beta 0.80.00 / v0.80.0)
# ==============================================================================
set -e

echo "============================================================================"
echo "  AI NetController v0.80.0 (Beta 0.80.00) — Linux Setup Launcher"
echo "============================================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/4] Checking Python 3 & Node.js environment..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] Node.js / npm not found. Please install Node.js 20+ before running."
    exit 1
fi

PYTHON_BIN="python3"
if command -v python3 >/dev/null 2>&1; then
    if [ ! -d "agent/.venv" ]; then
        python3 -m venv agent/.venv 2>/dev/null || true
    fi
    if [ -x "agent/.venv/bin/python" ]; then
        PYTHON_BIN="agent/.venv/bin/python"
    fi
    if [ -f "agent/requirements.txt" ]; then
        if ! "$PYTHON_BIN" -c "import websockets, psutil, mss, PIL" >/dev/null 2>&1; then
            echo "      Installing Python requirements..."
            "$PYTHON_BIN" -m pip install -r agent/requirements.txt --quiet || echo "[!] Warning: pip install had errors; continuing with available packages."
        fi
    fi
else
    echo "[!] python3 not found. Please install Python 3.10+ (sudo apt install python3 python3-venv python3-pip)."
fi

echo "[2/4] Verifying LAN-scoped Linux firewall rules (RFC1918 only)..."
if command -v ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -q "Status: active"; then
    for subnet in 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12; do
        sudo ufw allow from "$subnet" to any port 8765 proto tcp comment 'AI NetController Daemon (LAN)' 2>/dev/null || true
        sudo ufw allow from "$subnet" to any port 3000 proto tcp comment 'AI NetController Web (LAN)' 2>/dev/null || true
    done
fi

DAEMON_PID=""
cleanup() {
    if [ -n "$DAEMON_PID" ]; then
        kill "$DAEMON_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo "[3/4] Launching AI NetController Host Agent Daemon..."
if [ -f "agent/agent.py" ]; then
    "$PYTHON_BIN" agent/agent.py &
    DAEMON_PID=$!
    echo "      Daemon started (PID: $DAEMON_PID)"
fi

echo "[4/4] Starting Web & Phone Controller Server on Port 3000..."
if [ ! -d "node_modules" ]; then
    echo "      Installing Node.js dependencies (first-time setup)..."
    npm install
fi

echo ""
echo "[READY] Waiting for Web Server on http://localhost:3000 before opening browser..."
if command -v xdg-open >/dev/null 2>&1; then
    (
        for _ in $(seq 1 40); do
            if "$PYTHON_BIN" -c "import socket; s=socket.create_connection(('127.0.0.1',3000),0.4); s.close()" 2>/dev/null; then
                xdg-open "http://localhost:3000/?setup=1" 2>/dev/null || true
                break
            fi
            sleep 0.5
        done
    ) &
fi

npm run dev

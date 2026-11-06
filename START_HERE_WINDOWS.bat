@echo off
title CST NetController AI — 1-Click PC & Phone Launcher
color 0B
echo ============================================================================
echo   CST NetController AI v3.1.0-beta.3 — 1-Click PC ^& Phone Setup Launcher
echo ============================================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Python environment for PC Host Daemon...
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    if exist "agent\requirements.txt" (
        echo       Installing Python packages ^(websockets, psutil, mss, Pillow, pyautogui, pystray^)...
        python -m pip install -r agent\requirements.txt --quiet 2>nul
    )
) else (
    echo [!] Python not found in PATH. Will use standalone CST_HostAgent.exe if available.
)

echo [2/4] Configuring Windows Private LAN Firewall rules ^(Ports 8765, 3000, UDP 9^)...
netsh advfirewall firewall show rule name="CST NetController Daemon" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    netsh advfirewall firewall add rule name="CST NetController Daemon" dir=in action=allow protocol=TCP localport=8765 profile=private >nul 2>nul
    netsh advfirewall firewall add rule name="CST NetController Web" dir=in action=allow protocol=TCP localport=3000 profile=private >nul 2>nul
    netsh advfirewall firewall add rule name="CST NetController WoL" dir=in action=allow protocol=UDP localport=9 profile=private >nul 2>nul
)

echo [3/4] Starting CST PC Host Daemon Desktop Control Center GUI...
if exist "agent\dist\CST_HostAgent\CST_HostAgent.exe" (
    start "CST PC Daemon" "agent\dist\CST_HostAgent\CST_HostAgent.exe"
) else if exist "agent\agent.py" (
    start "CST PC Daemon" python "agent\agent.py"
) else if exist "agent\agent_daemon.py" (
    start "CST PC Daemon" python "agent\agent_daemon.py"
)

echo [4/4] Starting Web ^& Phone Controller Server on Port 3000...
if not exist "node_modules" (
    echo       Installing Node.js dependencies ^(first-time setup^)...
    call npm install
)

echo.
echo [READY] Opening Quick Setup ^& Phone QR Pairing Wizard in your browser...
start "" "http://localhost:3000/?setup=1"
call npm run dev

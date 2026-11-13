@echo off
title AI NetController -- 1-Click PC & Phone Launcher
color 0B
echo ============================================================================
echo   AI NetController v0.50.0 ^(Beta 0.50.00^) -- 1-Click PC ^& Phone Setup Launcher
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
    echo [!] Python not found in PATH. Will use standalone AI_NetController_HostAgent.exe if available.
)

echo [2/4] Configuring Windows Private LAN Firewall rules ^(Ports 8765, 3000, UDP 9^)...
netsh advfirewall firewall show rule name="AI NetController Daemon" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    netsh advfirewall firewall add rule name="AI NetController Daemon" dir=in action=allow protocol=TCP localport=8765 profile=private >nul 2>nul
    netsh advfirewall firewall add rule name="AI NetController Web" dir=in action=allow protocol=TCP localport=3000 profile=private >nul 2>nul
    netsh advfirewall firewall add rule name="AI NetController WoL" dir=in action=allow protocol=UDP localport=9 profile=private >nul 2>nul
)

echo [3/4] Starting AI NetController Host Agent Desktop Control Center GUI...
if exist "agent\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe" (
    start "AI NetController Host Agent" "agent\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe"
) else if exist "agent\agent.py" (
    start "AI NetController Host Agent" python "agent\agent.py"
) else if exist "agent\agent_daemon.py" (
    start "AI NetController Host Agent" python "agent\agent_daemon.py"
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

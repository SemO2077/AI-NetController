@echo off
setlocal
title AI NetController -- PC ^& Phone Setup Launcher
color 0B
echo ============================================================================
echo   AI NetController v0.100.0 ^(Beta 0.100.00^) -- PC ^& Phone Setup Launcher
echo ============================================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Python ^& Node.js environment...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH. Please install Node.js 22+ LTS from https://nodejs.org/
    pause
    exit /b 1
)

set "PYTHON_BIN="
if exist ".venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\.venv\Scripts\python.exe"
) else if exist "agent\.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\agent\.venv\Scripts\python.exe"
) else (
    where python >nul 2>nul && set "PYTHON_BIN=python"
)

if defined PYTHON_BIN (
    if exist "agent\requirements.txt" (
        "%PYTHON_BIN%" -c "import websockets, psutil, mss, PIL, cryptography" >nul 2>nul
        if errorlevel 1 (
            echo       Installing Python packages ^(agent\requirements.txt^)...
            "%PYTHON_BIN%" -m pip install -r agent\requirements.txt --quiet
        )
    )
) else (
    echo [!] Python not found in PATH or .venv. Will use prebuilt AI_NetController_HostAgent.exe if available.
)

echo [2/4] Configuring Windows Private LAN Firewall rules ^(Ports 8765, UDP 8766, 3000, UDP 9^)...
netsh advfirewall firewall show rule name="AI NetController Daemon" >nul 2>nul
if errorlevel 1 (
    netsh advfirewall firewall add rule name="AI NetController Daemon" dir=in action=allow protocol=TCP localport=8765 profile=private >nul 2>nul
)
netsh advfirewall firewall show rule name="AI NetController Discovery" >nul 2>nul
if errorlevel 1 (
    netsh advfirewall firewall add rule name="AI NetController Discovery" dir=in action=allow protocol=UDP localport=8766 profile=private >nul 2>nul
)
netsh advfirewall firewall show rule name="AI NetController Web" >nul 2>nul
if errorlevel 1 (
    netsh advfirewall firewall add rule name="AI NetController Web" dir=in action=allow protocol=TCP localport=3000 profile=private >nul 2>nul
)
netsh advfirewall firewall show rule name="AI NetController WoL" >nul 2>nul
if errorlevel 1 (
    netsh advfirewall firewall add rule name="AI NetController WoL" dir=in action=allow protocol=UDP localport=9 profile=private >nul 2>nul
)

echo [3/4] Starting AI NetController Host Agent Desktop Control Center GUI...
set "PYTHONPATH=%CD%;%CD%\agent;%PYTHONPATH%"
if defined PYTHON_BIN (
    if exist "agent\agent.py" (
        start "AI NetController Host Agent" "%PYTHON_BIN%" "agent\agent.py"
    ) else if exist "agent\agent_daemon.py" (
        start "AI NetController Host Agent" "%PYTHON_BIN%" "agent\agent_daemon.py"
    )
) else if exist "agent\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe" (
    start "AI NetController Host Agent" "agent\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe"
) else if exist "agent\dist\AI_NetController_HostAgent_standalone.exe" (
    start "AI NetController Host Agent" "agent\dist\AI_NetController_HostAgent_standalone.exe"
) else (
    echo [!] Host Agent skipped: install Python 3.11+ or build the Windows executable first.
)

echo [4/4] Starting Web ^& Phone Controller Server on Port 3000...
if not exist "node_modules" (
    echo       Installing Node.js dependencies ^(first-time setup^)...
    call npm.cmd install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check network connectivity and Node.js version ^(22+ recommended^).
        pause
        exit /b 1
    )
)

echo.
echo [READY] Waiting for Web Server on http://localhost:3000 before opening browser...
start "" /B powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 40;$i++){try{$c=New-Object System.Net.Sockets.TcpClient('127.0.0.1',3000);$c.Close();Start-Process 'http://localhost:3000/?setup=1';break}catch{Start-Sleep -Milliseconds 500}}"
call npm.cmd run dev
endlocal

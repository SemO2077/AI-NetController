@echo off
cd /d "%~dp0"
echo =========================================================
echo AI NetController Host Agent - Windows EXE Builder (v0.50.00 Beta)
echo (AV-Safe Desktop GUI Edition • Zero UPX • Authenticode)
echo =========================================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in system PATH!
    echo Please download Python 3.11+ from https://www.python.org/
    echo Ensure you check 'Add python.exe to PATH' during install.
    if "%CI%"=="" pause
    exit /b 1
)

echo [1/4] Setting up Python virtual environment...
if not exist "venv" (
    python -m venv venv
    if errorlevel 1 exit /b 1
)
call venv\Scripts\activate
if errorlevel 1 exit /b 1

echo [2/4] Installing dependencies and PyInstaller...
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies.
    if "%CI%"=="" pause
    exit /b 1
)

echo [3/4] Compiling AV-Safe Desktop GUI Executable (No UPX)...
pyinstaller --clean -y build_agent.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    if "%CI%"=="" pause
    exit /b 1
)

if exist "dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe" (
    echo [4/4] Applying Authenticode Digital Signature and Defender Check...
    powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -ExePath "dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe"
    if errorlevel 1 exit /b 1
    if exist "dist\AI_NetController_HostAgent_standalone.exe" (
        powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -ExePath "dist\AI_NetController_HostAgent_standalone.exe"
        if errorlevel 1 exit /b 1
    )
    echo.
    echo =========================================================
    echo [SUCCESS] Standalone GUI Executable Created!
    echo Location: %cd%\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe
    echo.
    echo Double-click AI_NetController_HostAgent.exe to open the Desktop Control
    echo Center GUI with live telemetry, security toggles, and mDNS.
    echo =========================================================
) else (
    echo.
    echo [ERROR] Build failed: executable not found.
    if "%CI%"=="" pause
    exit /b 1
)
if "%CI%"=="" pause



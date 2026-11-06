@echo off
echo =========================================================
echo AI NetController Host Agent - 1-Click Windows EXE Builder
echo (AV-Safe Desktop GUI Edition • Zero UPX • Authenticode)
echo =========================================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in system PATH!
    echo Please download Python 3.11+ from https://www.python.org/
    echo Ensure you check 'Add python.exe to PATH' during install.
    pause
    exit /b 1
)

echo [1/4] Setting up Python virtual environment...
if not exist "venv" (
    python -m venv venv
)
call venv\Scripts\activate

echo [2/4] Installing dependencies and PyInstaller...
python -m pip install --upgrade pip
pip install -r requirements.txt

echo [3/4] Compiling AV-Safe Desktop GUI Executable (No UPX)...
pyinstaller --clean build_agent.spec

if exist "dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe" (
    echo [4/4] Applying Authenticode Digital Signature & Defender Check...
    powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -ExePath "dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe"
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
    echo [ERROR] Build failed. Review log above.
)
pause


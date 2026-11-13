@echo off
cd /d "%~dp0"
echo =========================================================
echo AI NetController Host Agent - Windows Builder (v0.51.0 Beta)
echo (Smart-App-Control-Aligned --onedir - Zero UPX - Signed)
echo =========================================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in system PATH!
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

echo [2/4] Installing dependencies via python -m pip...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies.
    if "%CI%"=="" pause
    exit /b 1
)

echo [3/4] Compiling clean --onedir Desktop Control Center (Zero UPX, Zero SFX Temp Unpacker)...
python -m PyInstaller --clean -y build_agent.spec
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    if "%CI%"=="" pause
    exit /b 1
)

if exist "dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe" (
    echo [4/4] Signing ALL .exe/.dll/.pyd files and running Defender scan...
    if "%AI_ALLOW_SELFSIGNED%"=="1" (
        powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -TargetPath "dist\AI_NetController_HostAgent" -AllowSelfSigned
    ) else (
        powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -TargetPath "dist\AI_NetController_HostAgent"
    )
    if errorlevel 1 exit /b 1
    echo.
    echo =========================================================
    echo [SUCCESS] Signed --onedir GUI Bundle Created!
    echo Executable: %cd%\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe
    echo Tip: Run package_msix.ps1 for signed Windows 11 MSIX packaging.
    echo =========================================================
) else (
    echo [ERROR] Build failed: executable not found.
    if "%CI%"=="" pause
    exit /b 1
)
if "%CI%"=="" pause

@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title AI NetController Host Agent -- Instant Windows EXE Builder
echo ============================================================================
echo   AI NetController Host Agent v0.90.0 (Beta 0.90.00) -- Instant EXE Builder
echo   (Warm-Cache PyInstaller --onedir + Standalone EXE ^| Zero UPX ^| Signed)
echo ============================================================================
echo.

set "NO_PAUSE=0"
set "CLEAN_BUILD=0"
set "ONEDIR_ONLY=0"
for %%A in (%*) do (
    if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
    if /I "%%~A"=="--clean" set "CLEAN_BUILD=1"
    if /I "%%~A"=="--onedir-only" set "ONEDIR_ONLY=1"
)

echo [1/4] Resolving Python environment...
set "PYTHON_BIN="
if exist "..\.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\..\.venv\Scripts\python.exe"
) else if exist ".venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\.venv\Scripts\python.exe"
) else if exist "venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\venv\Scripts\python.exe"
) else (
    where python >nul 2>&1
    if !errorlevel! neq 0 (
        echo [ERROR] Python is not installed or not in system PATH!
        if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
        exit /b 1
    )
    python -m venv venv
    if errorlevel 1 exit /b 1
    set "PYTHON_BIN=%CD%\venv\Scripts\python.exe"
)
echo       Using Python: !PYTHON_BIN!

echo [2/4] Verifying Python dependencies ^& PyInstaller...
"!PYTHON_BIN!" -c "import PyInstaller, websockets, psutil, mss, PIL, cryptography, numpy, zeroconf, pystray, pyautogui, pyperclip" >nul 2>&1
if errorlevel 1 (
    echo       Installing missing Python packages ^(requirements.txt^)...
    "!PYTHON_BIN!" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install Python dependencies.
        if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
        exit /b 1
    )
) else (
    echo       All required Python ^& PyInstaller packages verified cached.
)

if exist "..\scripts\build_release_binaries.py" (
    echo [3/4] Running Instant EXE ^& Portable Release Builder...
    "!PYTHON_BIN!" "..\scripts\build_release_binaries.py" --exe-only %*
    set "BUILD_EXIT=!ERRORLEVEL!"
    if !BUILD_EXIT! neq 0 (
        echo [ERROR] EXE Builder failed with exit code !BUILD_EXIT!.
        if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
        exit /b !BUILD_EXIT!
    )
    echo.
    echo ============================================================================
    echo [SUCCESS] Signed Windows Host Agent Binaries Built ^& Staged!
    echo   --onedir GUI : %CD%\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe
    if exist "dist\AI_NetController_HostAgent_standalone.exe" (
        echo   Standalone   : %CD%\dist\AI_NetController_HostAgent_standalone.exe
    )
    echo   Releases Dir : %CD%\..\public\releases\v0.90.0\
    echo ============================================================================
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b 0
)

echo [3/4] Compiling Desktop Control Center (Zero UPX, Incremental Cache)...
if "!ONEDIR_ONLY!"=="1" set "AI_BUILD_ONEFILE=0"
if "!CLEAN_BUILD!"=="1" (
    "!PYTHON_BIN!" -m PyInstaller --clean -y build_agent.spec
) else (
    "!PYTHON_BIN!" -m PyInstaller --noconfirm build_agent.spec
)
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b 1
)

if exist "dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe" (
    echo [4/4] Signing PE binaries and verifying integrity...
    if defined AI_CODESIGN_THUMBPRINT (
        powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -TargetPath "dist\AI_NetController_HostAgent"
    ) else (
        powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -TargetPath "dist\AI_NetController_HostAgent" -AllowSelfSigned -SkipTimestamp
    )
    if errorlevel 1 exit /b 1
    if exist "dist\AI_NetController_HostAgent_standalone.exe" (
        if defined AI_CODESIGN_THUMBPRINT (
            powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -TargetPath "dist\AI_NetController_HostAgent_standalone.exe"
        ) else (
            powershell -ExecutionPolicy Bypass -File sign_binary.ps1 -TargetPath "dist\AI_NetController_HostAgent_standalone.exe" -AllowSelfSigned -SkipTimestamp
        )
    )
    echo.
    echo ============================================================================
    echo [SUCCESS] Signed --onedir GUI Bundle Created!
    echo Executable: %CD%\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe
    echo ============================================================================
) else (
    echo [ERROR] Build failed: executable not found.
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b 1
)
if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
endlocal

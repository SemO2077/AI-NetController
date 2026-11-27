@echo off
setlocal EnableDelayedExpansion
title AI NetController Mobile -- Instant Release APK Builder
echo ============================================================================
echo   AI NetController Mobile v0.100.0 (Beta 0.100.00) -- Instant APK Builder
echo   (Warm-Cache Incremental Build ^| Direct Touchscreen ^& LAN UDP Discovery)
echo ============================================================================
echo.

cd /d "%~dp0"
set "NO_PAUSE=0"
set "CLEAN_BUILD=0"
set "FAST_ARM64=0"
for %%A in (%*) do (
    if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
    if /I "%%~A"=="--clean" set "CLEAN_BUILD=1"
    if /I "%%~A"=="--fast" set "FAST_ARM64=1"
    if /I "%%~A"=="--arm64-only" set "FAST_ARM64=1"
)

:: 1. Resolve Python orchestrator (handles JDK 17/21, Android SDK, Flutter SDK & release staging)
set "PYTHON_BIN="
if exist "..\..\.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\..\..\.venv\Scripts\python.exe"
) else if exist "..\..\agent\.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\..\..\agent\.venv\Scripts\python.exe"
) else (
    where python >nul 2>nul && set "PYTHON_BIN=python"
)

if defined PYTHON_BIN (
    if exist "..\..\scripts\build_android_app.py" (
        "%PYTHON_BIN%" "..\..\scripts\build_android_app.py" %*
        set "BUILD_EXIT=!ERRORLEVEL!"
        if !BUILD_EXIT! neq 0 (
            echo.
            echo [ERROR] Instant APK Builder exited with code !BUILD_EXIT!.
            if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
            exit /b !BUILD_EXIT!
        )
        if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
        exit /b 0
    )
)

:: 2. Standalone fallback if scripts\build_android_app.py is absent
if exist "%USERPROFILE%\flutter\bin\flutter.bat" (
    set "PATH=%USERPROFILE%\flutter\bin;%PATH%"
)
if not defined JAVA_HOME (
    if exist "%LOCALAPPDATA%\Programs\Temurin-21\bin\javac.exe" (
        set "JAVA_HOME=%LOCALAPPDATA%\Programs\Temurin-21"
    ) else if exist "%LOCALAPPDATA%\Programs\Temurin-17\bin\javac.exe" (
        set "JAVA_HOME=%LOCALAPPDATA%\Programs\Temurin-17"
    ) else if exist "C:\Program Files\Android\Android Studio\jbr\bin\javac.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    )
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

where flutter >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Flutter SDK not found in system PATH!
    echo Please install Flutter 3.29+ from https://docs.flutter.dev/get-started/install
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b 1
)

if "!CLEAN_BUILD!"=="1" (
    echo [1/3] Cleaning build cache ^(--clean requested^)...
    call flutter clean
)

set "FIRST_PUB_FLAG=--no-pub"
if not exist ".dart_tool\package_config.json" (
    echo [1/2] Fetching dependencies...
    call flutter pub get
    set "FIRST_PUB_FLAG="
)
if exist "android\app\src\main\java\io\flutter\plugins\GeneratedPluginRegistrant.java" (
    findstr /i "integration_test home_widget" "android\app\src\main\java\io\flutter\plugins\GeneratedPluginRegistrant.java" >nul 2>&1
    if !errorlevel! equ 0 set "FIRST_PUB_FLAG="
) else (
    set "FIRST_PUB_FLAG="
)

if "!FAST_ARM64!"=="1" (
    echo [2/2] Building Instant Release arm64-v8a APK...
    call flutter build apk --release --split-per-abi --target-platform android-arm64 !FIRST_PUB_FLAG!
) else (
    echo [2/2] Building Optimized Release APKs ^(Split-per-ABI + Universal^)...
    call flutter build apk --release --split-per-abi !FIRST_PUB_FLAG!
    call flutter build apk --release --no-pub
)

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Flutter build failed. Review log above.
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b 1
)

echo.
echo ============================================================================
echo [SUCCESS] Release APKs Generated!
echo Location: %CD%\build\app\outputs\flutter-apk\
echo   - app-arm64-v8a-release.apk   ^(Modern 64-bit Android devices^)
echo   - app-release.apk             ^(Universal Multi-ABI APK^)
echo ============================================================================
if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
endlocal

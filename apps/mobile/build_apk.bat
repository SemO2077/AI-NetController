@echo off
echo =========================================================
echo AI NetController Mobile - 1-Click Release APK Builder
echo =========================================================
echo.

flutter --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Flutter SDK not found in system PATH!
    echo Please install Flutter 3.24+ from https://docs.flutter.dev/get-started/install
    pause
    exit /b 1
)

cd /d "%~dp0"

echo [1/2] Fetching dependencies...
call flutter clean
call flutter pub get

echo [2/2] Building Optimized Release APKs (Split-per-ABI)...
call flutter build apk --release --split-per-abi

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Flutter build failed. Review log above.
    pause
    exit /b 1
)

echo.
echo =========================================================
echo [SUCCESS] Release APKs Generated!
echo Location: build\app\outputs\flutter-apk\
echo.
echo Outputs:
echo - app-arm64-v8a-release.apk   (Recommended: Modern 64-bit Android devices)
echo - app-armeabi-v7a-release.apk (Legacy 32-bit devices)
echo - app-x86_64-release.apk     (Emulators / ChromeOS)
echo =========================================================
pause

@echo off
setlocal EnableDelayedExpansion
title AI NetController -- Daemon Launcher ^& Full Test Suite
color 0B
cd /d "%~dp0"

set "NO_PAUSE=0"
for %%A in (%*) do (
    if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
    if /I "%%~A"=="--verify-only" set "NO_PAUSE=1"
    if /I "%%~A"=="--self-test" set "NO_PAUSE=1"
)

set "PYTHON_BIN="
if exist ".venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\.venv\Scripts\python.exe"
) else if exist "agent\.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\agent\.venv\Scripts\python.exe"
) else if exist "agent\venv\Scripts\python.exe" (
    set "PYTHON_BIN=%CD%\agent\venv\Scripts\python.exe"
) else (
    where python >nul 2>nul && set "PYTHON_BIN=python"
)

if not defined PYTHON_BIN (
    echo [ERROR] Python 3.11+ not found in .venv or PATH.
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b 1
)

"%PYTHON_BIN%" "scripts\launch_and_test_daemon.py" %*
set "EXIT_CODE=!ERRORLEVEL!"
if !EXIT_CODE! neq 0 (
    echo.
    echo [ERROR] Launch ^& Test Orchestrator exited with code !EXIT_CODE!.
    if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
    exit /b !EXIT_CODE!
)
if "%CI%"=="" if "!NO_PAUSE!"=="0" pause
endlocal

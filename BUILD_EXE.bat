@echo off
setlocal
cd /d "%~dp0"
call "%~dp0agent\build_exe.bat" %*
exit /b %ERRORLEVEL%

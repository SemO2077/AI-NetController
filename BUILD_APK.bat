@echo off
setlocal
cd /d "%~dp0"
call "%~dp0apps\mobile\build_apk.bat" %*
exit /b %ERRORLEVEL%

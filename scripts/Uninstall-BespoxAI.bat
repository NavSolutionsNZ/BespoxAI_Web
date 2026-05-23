@echo off
setlocal

:: Self-elevate if not already running as Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Run the uninstaller PS1 from the same directory as this .bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-BespoxAI.ps1" %*

echo.
pause

@echo off
setlocal

:: Self-elevate if not already running as Administrator (token elevation
:: check, not net session -- that depends on the LanmanServer service,
:: which is commonly disabled on lean Server Core / container images
:: regardless of actual privilege level)
powershell -NoProfile -Command "if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }"
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Run the uninstaller PS1 from the same directory as this .bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-BespoxAI.ps1" %*

echo.
pause

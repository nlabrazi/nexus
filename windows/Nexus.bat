@echo off
set "SCRIPT_PATH=%~dp0NexusTray.ps1"
if not exist "%SCRIPT_PATH%" (
    set "SCRIPT_PATH=%USERPROFILE%\Nexus\NexusTray.ps1"
)
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_PATH%"

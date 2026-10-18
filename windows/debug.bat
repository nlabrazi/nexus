@echo off
title Nexus Tray - Mode Debug
color 0B
echo ========================================================
echo   Nexus System Tray - Diagnostic et Lancement Debug
echo ========================================================
echo.

set "SCRIPT_PATH=%~dp0NexusTray.ps1"
if not exist "%SCRIPT_PATH%" (
    set "SCRIPT_PATH=C:\Users\Zref\Nexus\NexusTray.ps1"
)

if not exist "%SCRIPT_PATH%" (
    echo [ERREUR] Impossible de trouver NexusTray.ps1.
    echo Chemin teste : %SCRIPT_PATH%
    pause
    exit /b 1
)

echo Script trouve : %SCRIPT_PATH%
echo Lancement en mode interactif avec logs visibles...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%SCRIPT_PATH%" -DebugMode
pause

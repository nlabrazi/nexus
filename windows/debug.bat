@echo off
title Nexus Tray - Mode Debug
color 0B
echo ========================================================
echo   Nexus System Tray - Diagnostic et Lancement Debug
echo ========================================================
echo.
echo Ce script va lancer l'application System Tray en affichant
echo tous les logs et erreurs potentielles dans cette fenetre.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0NexusTray.ps1" -DebugMode
pause

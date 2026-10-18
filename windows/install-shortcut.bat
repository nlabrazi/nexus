@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "TARGET_VBS=%SCRIPT_DIR%Nexus.vbs"
set "ICON_FILE=%SCRIPT_DIR%nexus.ico"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "SHORTCUT_PATH=%DESKTOP_DIR%\Nexus.lnk"

echo Installation du raccourci Nexus sur le Bureau Windows...

powershell -NoProfile -Command ^
  "$wsh = New-Object -ComObject WScript.Shell; " ^
  "$s = $wsh.CreateShortcut('%SHORTCUT_PATH%'); " ^
  "$s.TargetPath = 'wscript.exe'; " ^
  "$s.Arguments = '\"%TARGET_VBS%\"'; " ^
  "$s.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$s.IconLocation = '%ICON_FILE%,0'; " ^
  "$s.Description = 'Nexus Agent - Lanceur System Tray'; " ^
  "$s.Save();"

if exist "%SHORTCUT_PATH%" (
    echo [OK] Raccourci cree avec succes sur votre Bureau : %SHORTCUT_PATH%
) else (
    echo [ERREUR] Impossible de creer le raccourci sur le Bureau.
)

echo.
echo Vous pouvez maintenant double-cliquer sur le raccourci Nexus sur votre Bureau !
echo.
pause


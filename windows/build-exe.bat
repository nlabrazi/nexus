@echo off
title Compilation de Nexus.exe
color 0A
setlocal

echo ========================================================
echo   Compilation de Nexus.exe (Application Native Windows)
echo ========================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "CSC_64=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "CSC_32=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

set "CSC="
if exist "%CSC_64%" set "CSC=%CSC_64%"
if not defined CSC if exist "%CSC_32%" set "CSC=%CSC_32%"

if not defined CSC (
    echo [ERREUR] Le compilateur C# csc.exe est introuvable.
    echo Assurez-vous que .NET Framework 4.5+ est installe sur Windows.
    pause
    exit /b 1
)

echo Compilateur detecte : %CSC%
echo Compilation en cours...

set "CS_FILE=%SCRIPT_DIR%NexusTray.cs"
set "ICON_FILE=%SCRIPT_DIR%nexus.ico"
set "OUT_EXE=%SCRIPT_DIR%Nexus.exe"

if not exist "%CS_FILE%" (
    echo [ERREUR] Fichier source introuvable : %CS_FILE%
    pause
    exit /b 1
)

"%CSC%" /nologo /target:winexe /win32icon:"%ICON_FILE%" /out:"%OUT_EXE%" /optimize "%CS_FILE%"

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCES] Nexus.exe genere avec succes !
    echo Emplacement : %OUT_EXE%
    
    REM Copier sur le Bureau Windows si accessible
    if exist "%USERPROFILE%\Desktop" (
        copy /y "%OUT_EXE%" "%USERPROFILE%\Desktop\Nexus.exe" >nul
        echo [OK] Copie sur votre Bureau : %USERPROFILE%\Desktop\Nexus.exe
    )
    echo.
    echo Vous pouvez desormais double-cliquer directement sur Nexus.exe !
) else (
    echo.
    echo [ECHEC] La compilation a echoue avec le code %ERRORLEVEL%.
)

echo.
pause

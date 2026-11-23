@echo off
chcp 65001 >nul
title Codex with Frosted Glass

rem ---- Locate inject.js: same folder first, then optional CF_HOME override ----
cd /d "%~dp0"
if not exist "inject.js" (
    if defined CF_HOME if exist "%CF_HOME%\inject.js" cd /d "%CF_HOME%"
)
if not exist "inject.js" (
    echo.
    echo   [x] inject.js not found next to this script.
    echo       Current dir: %CD%
    echo       Tip: set CF_HOME to the folder that holds inject.js
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [x] Node.js not found in PATH. Install Node 18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

node inject.js --open %*
set RC=%errorlevel%

if not "%RC%"=="0" (
    echo.
    echo   [x] Failed. Exit code %RC%
    echo.
    pause
    exit /b %RC%
)

"%SystemRoot%\System32\timeout.exe" /t 3 /nobreak >nul 2>nul
exit /b 0

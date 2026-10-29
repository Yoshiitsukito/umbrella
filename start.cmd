@echo off
setlocal
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"
if not "%NODE%"=="node" if not exist "%NODE%" (
  echo Node.js not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4173"
"%NODE%" server.mjs
pause

@echo off
title JARVIS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Your browser will open the download page. Install the LTS version,
  echo  then double-click this file again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist jarvis-settings.txt (
  copy /y jarvis-settings.example.txt jarvis-settings.txt >nul
  echo  Created jarvis-settings.txt. Open it in Notepad to choose what Jarvis
  echo  calls you, its voice and other options.
  echo.
)

rem Jarvis talks to Claude through Claude Code, using your Claude subscription.
where claude >nul 2>nul
if errorlevel 1 if not exist "%USERPROFILE%\.local\bin\claude.exe" (
  echo  Jarvis uses Claude Code to talk to Claude with your Claude Pro or Max
  echo  subscription, so you don't need an API key. It isn't installed yet.
  echo.
  choice /c YN /m "  Install Claude Code now"
  if not errorlevel 2 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
    echo.
    echo  Now log in: a new window opens. Type /login if it doesn't ask, sign in with
    echo  your Claude account in the browser, then close that window.
    echo.
    start "Log in to Claude" "%USERPROFILE%\.local\bin\claude.exe"
    pause
  )
)

if not exist node_modules (
  echo  First run: installing what Jarvis needs. This takes a minute or two...
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo  Starting JARVIS at http://localhost:3200 (it opens in its own window).
echo  Keep this black window open while you use Jarvis. Close it to stop.
echo  To have Jarvis start by itself with Windows, double-click jarvis-autostart.bat.
echo.
node jarvis\server.js --open
echo.
echo  Jarvis has stopped.
pause

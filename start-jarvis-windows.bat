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
  echo  Created jarvis-settings.txt. Open it in Notepad to add your Claude API key
  echo  and choose what Jarvis calls you.
  echo.
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
echo  Starting JARVIS. Open http://localhost:3200 in Chrome or Edge.
echo  Keep this window open while you use Jarvis. Close it to stop.
echo.
start "" http://localhost:3200
node jarvis\server.js
echo.
echo  Jarvis has stopped.
pause

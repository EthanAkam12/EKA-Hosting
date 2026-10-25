@echo off
title EKA Hosting
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

if not exist settings.txt (
  copy /y settings.example.txt settings.txt >nul
  echo  Created settings.txt. Open it in Notepad to choose your password
  echo  and, when you are ready, add your Claude API key.
  echo.
)

if not exist node_modules (
  echo  First run: installing what the builder needs. This takes a minute or two...
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

set HOST=127.0.0.1
set PORT=3000
set OPEN_BROWSER=1
echo.
echo  Starting EKA Hosting. Your browser will open in a moment.
echo  Keep this window open while you use the builder. Close it to stop.
echo.
node server\index.js
echo.
echo  The builder has stopped.
pause

@echo off
title EKA HQ
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

if not exist hq-settings.txt (
  copy /y hq-settings.example.txt hq-settings.txt >nul
  echo  Created hq-settings.txt. Open it in Notepad to choose your password
  echo  and, when you are ready, connect WHMCS, the builder and your phone.
  echo.
)

if not exist node_modules (
  echo  First run: installing what HQ needs. This takes a minute or two...
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

set HQ_HOST=127.0.0.1
echo.
echo  Starting EKA HQ. Open http://localhost:3100 in your browser.
echo  Keep this window open while HQ runs. Close it to stop.
echo  (To have HQ running all the time, put it on a server: see SERVER-SETUP.md.)
echo.
start "" http://localhost:3100
node hq\server\index.js
echo.
echo  HQ has stopped.
pause

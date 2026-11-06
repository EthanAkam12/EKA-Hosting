@echo off
title JARVIS start-up setting
cd /d "%~dp0"
if not exist node_modules (
  echo.
  echo  Run start-jarvis-windows.bat once first, so Jarvis is set up.
  echo.
  pause
  exit /b 1
)
echo.
echo  This switches "start Jarvis when Windows starts" on or off.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jarvis\autostart.ps1" toggle
echo.
echo  Double-click this file again to switch it the other way.
echo.
pause

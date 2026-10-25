@echo off
title Update EKA Hosting
cd /d "%~dp0"
echo.
echo  This downloads the latest version of the builder from GitHub.
echo  Your websites (the data folder) and settings.txt are kept.
echo.
echo  Close the builder's black window first if it is open.
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-windows.ps1"
echo.
echo  Double-click start-windows.bat to open the builder.
echo.
pause

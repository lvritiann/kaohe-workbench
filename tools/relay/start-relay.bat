@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  Kaohe Relay  (port 8788)
echo ========================================
echo.
node server.js
echo.
echo [stopped] press any key to close
pause >nul

@echo off
chcp 65001 >nul
cd /d "D:\加油站综合考核系统"
echo ============================================
echo   运营状态变更单  合并并推送
echo ============================================
echo.
python tools\status_push.py
echo.
pause

@echo off
chcp 65001 >nul
cd /d "D:\加油站综合考核系统"
echo ============================================
echo   运营状态变更单  自动捡取 / 合并 / 推送
echo ============================================
echo.
echo   会自动扫描你的「下载」目录里新签发的 ST-*.json
echo   找不到时会提示，也可手动放进 inbox\status\
echo.
python tools\status_push.py
echo.
pause

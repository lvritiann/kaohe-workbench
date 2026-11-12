@echo off
cd /d "%~dp0"
echo ============================================
echo   加油站考核 · 本地管理台
echo ============================================
echo.
echo   浏览器会自动打开 http://127.0.0.1:8902/
echo   用完直接关闭本窗口即可停止服务
echo.
python tools\local_console.py
echo.
pause

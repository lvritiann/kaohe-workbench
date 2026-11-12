@echo off
cd /d "%~dp0"
echo ============================================
echo   加油站考核 · 局域网管理台
echo ============================================
echo.
echo   启动后窗口里会显示同事要用的网址
echo   首次弹出 Windows 防火墙提示时，请勾选
echo   「专用网络」并点「允许访问」
echo.
echo   推送仍在本机执行，同事电脑只需浏览器
echo   用完关闭本窗口即停止服务
echo.
python tools\local_console.py --lan
echo.
pause

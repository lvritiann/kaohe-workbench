@echo off
cd /d "%~dp0"
echo ============================================
echo   重新生成「零配置版」直推客户端
echo   （换了令牌、或要发给新同事时运行）
echo ============================================
echo.
python tools\make_prebuilt_client.py
echo.
pause

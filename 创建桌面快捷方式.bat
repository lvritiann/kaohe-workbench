@echo off
cd /d "%~dp0"
echo Creating desktop shortcut...
python tools\make_shortcut.py
echo.
pause

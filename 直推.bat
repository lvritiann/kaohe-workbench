@echo off
cd /d "%~dp0"
echo ============================================
echo   运营状态直推   （无需打开任何网页）
echo ============================================
echo.

rem ===== 每次只改这一段 =====
set "STATION=[填站名：15站之一，如 华山]"
set "STATUS_CODE=[填状态：temp_closed / partial / force_majeure / reopened / normal]"
set "FROM_DATE=[填起始日期：YYYY-MM-DD，如 2026-12-01]"
set "TO_DATE=[填结束日期：YYYY-MM-DD；留空表示持续有效]"
set "REASON=[填原因依据，如 关停结束恢复营业]"
set "OPERATOR=[填签发人，如 计划经营科]"
set "AFFECTED_DAYS=[仅 partial/force_majeure 填实际经营天数；其余留空]"
set "EVIDENCE=[填佐证说明，可留空]"
rem ==========================

echo   油站  : %STATION%
echo   状态  : %STATUS_CODE%
echo   期间  : %FROM_DATE% 起
echo.
python tools\issue_direct.py
if errorlevel 1 (
  echo.
  echo   [失败] 未生效。按上面提示改参数后重试。
  pause
  exit /b 1
)
echo.
echo   [完成] 约 1 分钟后线上生效。
pause

@echo off
REM SAT-SA one-click launcher (Windows). Fully offline after the first install.
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv || goto :err
  .venv\Scripts\python -m pip install -r requirements.txt || goto :err
)
if not exist data\satsa.duckdb (
  echo Building dataset and running analysis ^(first run, ~3 minutes^)...
  .venv\Scripts\python -m satsa.pipeline || goto :err
)
echo SAT-SA running at http://localhost:8000
.venv\Scripts\python -m uvicorn satsa.api.main:app --host 127.0.0.1 --port 8000
goto :eof
:err
echo Setup failed. See messages above.
exit /b 1

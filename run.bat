@echo off
REM SAT-SA one-click launcher (Windows). Fully offline after installation.
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist .venv (
  if exist wheelhouse (
    call install_offline.bat || goto :err
  ) else (
    echo Creating virtual environment...
    python -m venv .venv || goto :err
    .venv\Scripts\python -m pip install -r requirements.txt || goto :err
  )
)
if not exist data\satsa.duckdb (
  echo Building the synthetic panel and running the analysis ^(first run, about 4 minutes^)...
  .venv\Scripts\python -m satsa.pipeline || goto :err
)
if not exist data\samples\submission .venv\Scripts\python -m satsa.gen.samples
echo SAT-SA running at http://localhost:8000  ^(Ctrl+C to stop^)
.venv\Scripts\python -m uvicorn satsa.api.main:app --host 127.0.0.1 --port 8000
goto :eof
:err
echo Setup failed. See messages above.
exit /b 1

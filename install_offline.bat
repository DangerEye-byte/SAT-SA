@echo off
REM Air-gapped install: uses no network. Needs Python 3.11+ on the target machine.
setlocal
cd /d "%~dp0"
if not exist wheelhouse ( echo wheelhouse\ not found - run prepare_offline.bat on a connected machine first & exit /b 1 )
python -m venv .venv || goto :err
.venv\Scripts\python -m pip install --no-index --find-links wheelhouse -r requirements.txt || goto :err
.venv\Scripts\python -m pip install --no-index --find-links wheelhouse llama-cpp-python 2>nul && echo Local AI runtime installed. || echo Local AI runtime not bundled; explanations will use templates.
echo Installed. Start SAT-SA with run.bat
goto :eof
:err
echo Install failed.
exit /b 1

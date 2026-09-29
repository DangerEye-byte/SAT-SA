@echo off
REM Run ONCE on a machine with internet. Produces everything needed to install SAT-SA on an
REM air-gapped machine: Python wheels (wheelhouse\), the optional local model (data\models\) and
REM the built web UI (satsa\api\static\). Copy the whole folder across afterwards.
REM Wheels match THIS machine's Python version: install the same Python minor version on the target.
setlocal
cd /d "%~dp0"
python -m pip download -r requirements.txt -d wheelhouse --only-binary=:all: || goto :err
python -m pip download -r requirements-ai.txt -d wheelhouse --only-binary=:all: || echo (optional AI runtime skipped)
if not exist data\models mkdir data\models
if not exist data\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf (
  echo Downloading the optional local model ^(2.5 GB, Apache-2.0^)...
  curl -L --fail -o data\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf || echo (model download skipped; explanations fall back to templates)
)
where npm >nul 2>nul && (cd web && npm ci && npm run build && cd ..)
python -c "import hashlib,pathlib;f=open('MANIFEST.sha256','w');[f.write(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.as_posix()+'\n') for p in sorted(pathlib.Path('wheelhouse').glob('*'))]"
echo Offline bundle ready. Copy this folder to the target machine and run install_offline.bat
goto :eof
:err
echo Failed.
exit /b 1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$venvPath = Join-Path $root ".venv311"
$pythonExe = Join-Path $venvPath "Scripts\python.exe"

if (-not (Test-Path $venvPath)) {
  py -3.11 -m venv $venvPath
}

& $pythonExe -m pip install --upgrade pip

& $pythonExe -m pip install `
  "numpy==2.3.3" `
  "fastapi==0.116.1" `
  "python-dotenv==1.1.1" `
  "requests==2.32.5" `
  "uvicorn==0.35.0" `
  "pillow" `
  "click" `
  "face-recognition-models==0.3.0" `
  "dlib-bin==20.0.0"

& $pythonExe -m pip install "face_recognition==1.3.0" --no-deps

Write-Host ""
Write-Host "Windows install complete."
Write-Host "Run the service with:"
Write-Host ".\.venv311\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8001"

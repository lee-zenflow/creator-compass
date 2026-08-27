[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = "C:\Temp\CreatorCompassRuntime"
$VirtualEnvironment = Join-Path $RuntimeRoot "embedding-venv"
$PythonExe = Join-Path $VirtualEnvironment "Scripts\python.exe"
$ModelCache = Join-Path $RuntimeRoot "model-cache"

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $ModelCache | Out-Null

if (-not (Test-Path -LiteralPath $PythonExe)) {
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  $launcherArgs = @("-3", "-m", "venv", $VirtualEnvironment)
  if (-not $launcher) {
    $launcher = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($launcher) {
      & $launcher.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
      if ($LASTEXITCODE -ne 0) { $launcher = $null }
      $launcherArgs = @("-m", "venv", $VirtualEnvironment)
    }
  }
  if (-not $launcher) { throw "Python 3.11 or newer was not found. Install Python first." }
  & $launcher.Source @launcherArgs
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the local embedding environment." }
}

$env:HF_HOME = $ModelCache
$env:PIP_CACHE_DIR = Join-Path $RuntimeRoot "pip-cache"
& $PythonExe -m pip install --disable-pip-version-check -r (Join-Path $ProjectRoot "embedding\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Local embedding dependencies could not be installed." }
& $PythonExe (Join-Path $ProjectRoot "embedding\download_model.py")
if ($LASTEXITCODE -ne 0) { throw "The Chinese embedding model could not be downloaded." }

Write-Host "Local Chinese semantic search is ready. Restart Creator Compass to use it." -ForegroundColor Green

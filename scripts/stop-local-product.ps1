$ErrorActionPreference = "Stop"

$RuntimeRoot = "C:\Temp\CreatorCompassRuntime"
$PostgresRoot = Join-Path $RuntimeRoot "postgresql-16.14"
$PostgresData = Join-Path $RuntimeRoot "postgres-data"

function Stop-OwnedProcess([string]$PidFile, [string]$ExpectedCommand) {
  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  $processId = [int](Get-Content -LiteralPath $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -like "*$ExpectedCommand*") {
    $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $processId }
    foreach ($child in $children) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-OwnedProcess (Join-Path $RuntimeRoot "creator-compass.pid") "scripts/start-production.mjs"
Stop-OwnedProcess (Join-Path $RuntimeRoot "embedding.pid") "uvicorn"

$pgCtl = Join-Path $PostgresRoot "bin\pg_ctl.exe"
if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath $PostgresData)) {
  & $pgCtl -D $PostgresData stop -m fast
}

Write-Host "Creator Compass stopped." -ForegroundColor Green

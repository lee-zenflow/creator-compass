[CmdletBinding()]
param([switch]$NoOpen)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = "C:\Temp\CreatorCompassRuntime"
$PostgresRoot = Join-Path $RuntimeRoot "postgresql-16.14"
$PostgresData = Join-Path $RuntimeRoot "postgres-data"
$EmbeddingPython = Join-Path $RuntimeRoot "embedding-venv\Scripts\python.exe"
$ModelCache = Join-Path $RuntimeRoot "model-cache"
$AppUrl = "http://127.0.0.1:3000"

function Test-LocalPort([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync("127.0.0.1", $Port)
    return $connection.Wait(500) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Require-Path([string]$Path, [string]$Message) {
  if (-not (Test-Path -LiteralPath $Path)) { throw $Message }
}

Require-Path (Join-Path $ProjectRoot ".env.local") "Missing .env.local."
Require-Path (Join-Path $PostgresRoot "bin\pg_ctl.exe") "Missing local PostgreSQL runtime."
Require-Path $PostgresData "Missing local PostgreSQL data directory."

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$migrationCount = (Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "drizzle") -Filter "*.sql").Count
$env:EXPECTED_MIGRATION_COUNT = [string]$migrationCount

if (-not (Test-LocalPort 5432)) {
  $postgres = Start-Process -FilePath (Join-Path $PostgresRoot "bin\pg_ctl.exe") -ArgumentList @(
    "-D", $PostgresData,
    "-l", (Join-Path $RuntimeRoot "postgres.log"),
    "start"
  ) -WindowStyle Hidden -PassThru
  $postgres.WaitForExit()
  if ($postgres.ExitCode -ne 0) { throw "PostgreSQL failed to start." }
}

if ((Test-Path -LiteralPath $EmbeddingPython) -and -not (Test-LocalPort 8765)) {
  $embeddingOptions = @{
    FilePath = $EmbeddingPython
    ArgumentList = @("-m", "uvicorn", "embedding.app:app", "--host", "127.0.0.1", "--port", "8765")
    WorkingDirectory = $ProjectRoot
    WindowStyle = "Hidden"
    PassThru = $true
    RedirectStandardOutput = Join-Path $RuntimeRoot "embedding.stdout.log"
    RedirectStandardError = Join-Path $RuntimeRoot "embedding.stderr.log"
  }
  $env:HF_HOME = $ModelCache
  $embedding = Start-Process @embeddingOptions
  Set-Content -LiteralPath (Join-Path $RuntimeRoot "embedding.pid") -Value $embedding.Id -Encoding ascii
} elseif (-not (Test-Path -LiteralPath $EmbeddingPython)) {
  Write-Warning "Local semantic search is not installed. Keyword fallback will be used. Run scripts\install-local-embedding.ps1 to install it."
}

Push-Location $ProjectRoot
try {
  & pnpm.cmd db:migrate
  if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }
  & pnpm.cmd db:seed
  if ($LASTEXITCODE -ne 0) { throw "Database seed failed." }

  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ".next\BUILD_ID"))) {
    & pnpm.cmd build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed." }
    & pnpm.cmd build:worker
    if ($LASTEXITCODE -ne 0) { throw "Worker build failed." }
  }

  if (-not (Test-LocalPort 3000)) {
    $startOptions = @{
      FilePath = "node.exe"
      ArgumentList = @("--env-file=.env.local", "scripts/start-production.mjs")
      WorkingDirectory = $ProjectRoot
      WindowStyle = "Hidden"
      PassThru = $true
      RedirectStandardOutput = Join-Path $RuntimeRoot "creator-compass.stdout.log"
      RedirectStandardError = Join-Path $RuntimeRoot "creator-compass.stderr.log"
    }
    $app = Start-Process @startOptions
    Set-Content -LiteralPath (Join-Path $RuntimeRoot "creator-compass.pid") -Value $app.Id -Encoding ascii
  }
} finally {
  Pop-Location
}

$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try {
    $health = Invoke-RestMethod -Uri "$AppUrl/api/health" -TimeoutSec 2
    if ($health.status -eq "healthy") { $healthy = $true; break }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $healthy) { throw "Health check failed. Review logs in $RuntimeRoot." }

if (-not $NoOpen) { Start-Process $AppUrl }
Write-Host "Creator Compass is running: $AppUrl" -ForegroundColor Green

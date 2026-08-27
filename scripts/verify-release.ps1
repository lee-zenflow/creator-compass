$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:E2E_DATABASE_URL)) {
    throw 'E2E_DATABASE_URL is required and must point to an isolated non-production database.'
}

try {
    $e2eUri = [System.Uri]$env:E2E_DATABASE_URL
} catch {
    throw 'E2E_DATABASE_URL must be a valid PostgreSQL URL.'
}

if ($e2eUri.Scheme -notin @('postgresql', 'postgres')) {
    throw 'E2E_DATABASE_URL must use the postgresql:// or postgres:// scheme.'
}

$e2eDatabaseName = [System.Uri]::UnescapeDataString($e2eUri.AbsolutePath.TrimStart('/'))
if ($e2eDatabaseName -notmatch '_(e2e|test|testing)$') {
    throw 'E2E_DATABASE_URL database name must end with _e2e, _test, or _testing.'
}

$env:DATABASE_URL = $env:E2E_DATABASE_URL
$env:TEST_DATABASE_URL = $env:E2E_DATABASE_URL
$env:E2E_BASE_URL = 'http://localhost:3101'
$env:PORT = '3101'
$env:E2E_REUSE_EXISTING_SERVER = '0'
$env:E2E_SERVER_MODE = 'production'
$env:LOCAL_RUNTIME_MODE = '1'
$env:AI_ADAPTER = 'test'
$e2eRuntimeRoot = Join-Path $env:TEMP 'CreatorCompassE2E'
$env:LOCAL_STORAGE_PATH = Join-Path $e2eRuntimeRoot 'private'
$env:LOCAL_SNAPSHOT_PATH = Join-Path $e2eRuntimeRoot 'snapshots'
$env:CREATOR_COMPASS_MASTER_KEY_PATH = Join-Path $e2eRuntimeRoot 'secrets\master.key'
$migrationCount = (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\drizzle') -Filter '*.sql').Count
$env:EXPECTED_MIGRATION_COUNT = [string]$migrationCount

function Assert-LastExitCode {
    param([Parameter(Mandatory = $true)][string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

& pnpm.cmd lint
Assert-LastExitCode 'lint'

& pnpm.cmd typecheck
Assert-LastExitCode 'typecheck'

& pnpm.cmd exec tsx scripts/reset-e2e-database.ts
Assert-LastExitCode 'isolated E2E database reset'

& pnpm.cmd db:migrate
Assert-LastExitCode 'E2E database migration'

& pnpm.cmd db:seed
Assert-LastExitCode 'E2E database seed'

& pnpm.cmd test
Assert-LastExitCode 'unit and integration tests'

& pnpm.cmd build
Assert-LastExitCode 'Next build'

& pnpm.cmd build:worker
Assert-LastExitCode 'worker build'

& pnpm.cmd exec tsx scripts/reset-e2e-database.ts
Assert-LastExitCode 'clean E2E database reset'

& pnpm.cmd db:migrate
Assert-LastExitCode 'clean E2E database migration'

& pnpm.cmd db:seed
Assert-LastExitCode 'clean E2E database seed'

& pnpm.cmd e2e
Assert-LastExitCode 'Playwright E2E'

Write-Host 'Creator Compass release verification passed.'

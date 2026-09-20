# Rebuilds the OpenSA flight-replay page and publishes it to web-replay/dist/opensa.
# ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, and non-ASCII
# comments break parsing.
# Requires the OpenSA monorepo dependencies: `npm install` inside tools/opensa.
$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $PSScriptRoot          # .../tools
$projectRoot = Split-Path -Parent $toolRoot           # .../GTASA-StuntTools
$opensa = $PSScriptRoot
if (-not (Test-Path (Join-Path $opensa 'node_modules'))) {
    Write-Host 'installing OpenSA dependencies...'
    & npm.cmd install --ignore-scripts --no-audit --no-fund --prefix $opensa
    if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)" }
}
Push-Location $opensa
try {
    & npx.cmd vite build --config vite.flight.config.ts
    if ($LASTEXITCODE -ne 0) { throw "vite build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
$dist = Join-Path $opensa 'dist-flight'
$target = Join-Path $projectRoot 'web-replay\dist\opensa'
if (Test-Path $target) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $backupRoot = Join-Path $projectRoot 'web-replay\backups'
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Move-Item $target (Join-Path $backupRoot "opensa.backup.$stamp")
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $dist '*') $target -Recurse -Force
Write-Host "published $target"

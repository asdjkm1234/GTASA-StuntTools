# Repairs the EVERYDAY Chrome profile's WebGPU state by RENAMING its GPU/Dawn caches (reversible).
# Caches regenerate on the next launch; nothing else in the profile is touched.
# Chrome/Edge MUST be fully closed first, or it rewrites the caches on exit.
$ErrorActionPreference = 'Stop'

$userData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
if (-not (Test-Path $userData)) { throw "Chrome User Data not found: $userData" }

$running = Get-Process chrome -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Chrome is still running ($($running.Count) processes)." -ForegroundColor Yellow
    Write-Host "Close ALL Chrome windows (check the tray), then run this again." -ForegroundColor Yellow
    exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
# Caches known to carry GPU/Dawn/WebGPU state. Missing ones are skipped.
$targets = @(
    'GraphiteDawnCache',
    'GrShaderCache',
    'ShaderCache',
    'GPUPersistentCache',
    'Default\DawnGraphiteCache',
    'Default\DawnWebGPUCache',
    'Default\GPUCache',
    'Default\GrShaderCache'
)

foreach ($relative in $targets) {
    $path = Join-Path $userData $relative
    if (-not (Test-Path $path)) {
        Write-Host "skip (absent): $relative"
        continue
    }
    $backup = "$path.bak-$stamp"
    try {
        Rename-Item -LiteralPath $path -NewName (Split-Path -Leaf $backup)
        Write-Host "renamed: $relative -> $(Split-Path -Leaf $backup)"
    } catch {
        Write-Host "FAILED to rename $relative : $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ''
Write-Host 'Done. Relaunch Chrome and open the diagnostic page:' -ForegroundColor Green
Write-Host '  http://127.0.0.1:4173/opensa/webgpu-check.html'
Write-Host 'If it still reports no adapter: chrome://settings/system -> enable hardware acceleration,'
Write-Host 'chrome://flags -> Reset all, update the Intel Arc driver, or create a new Chrome profile.'
Write-Host "To undo, rename the *.bak-$stamp folders back."

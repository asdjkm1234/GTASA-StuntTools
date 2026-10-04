# Build/run the real recorder's read-only damage, reset and CSV writer tests (ASCII only).
$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskZig = Join-Path $taskRepo 'tools/zig/zig-windows-x86_64-0.14.0/zig.exe'
$taskOut = Join-Path $taskRepo 'recorder/build/test-plane-damage.exe'
$taskFixture = Join-Path $taskRepo 'tools/opensa/captures/recorder-v13-damage-keys.csv'
New-Item -ItemType Directory -Force -Path (Split-Path $taskOut), (Split-Path $taskFixture) | Out-Null
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $taskRepo 'recorder/build/zig-cache-global'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $taskRepo 'recorder/build/zig-cache-local'
& $taskZig c++ -target x86-windows-gnu -O0 -o $taskOut (Join-Path $PSScriptRoot 'test-plane-damage.cpp') -lkernel32 -luser32
if ($LASTEXITCODE -ne 0) { throw "test compilation failed: $LASTEXITCODE" }
& $taskOut (Join-Path $taskRepo 'GTA San Andreas/gta_sa.exe') $taskFixture
if ($LASTEXITCODE -ne 0) { throw "damage tests failed: $LASTEXITCODE" }
$taskQuickhomeOut = Join-Path $taskRepo 'recorder/build/test-quickhome.exe'
$taskQuickhomeFixture = Join-Path $taskRepo 'tools/opensa/captures/recorder-quickhome'
& $taskZig c++ -target x86-windows-gnu -O0 -o $taskQuickhomeOut (Join-Path $PSScriptRoot 'test-quickhome.cpp') -lkernel32 -luser32
if ($LASTEXITCODE -ne 0) { throw "QuickHome test compilation failed: $LASTEXITCODE" }
$taskQuickhomeRecording = Join-Path $taskRepo 'GTA San Andreas/flight_recordings/flight_20261003_023248_358_m520_015.csv'
if (Test-Path -LiteralPath $taskQuickhomeRecording) {
    & $taskQuickhomeOut $taskQuickhomeRecording $taskQuickhomeFixture
} else {
    & $taskQuickhomeOut
}
if ($LASTEXITCODE -ne 0) { throw "QuickHome tests failed: $LASTEXITCODE" }

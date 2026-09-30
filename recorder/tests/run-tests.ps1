# Build/run the real recorder's read-only damage and CSV writer tests (ASCII only).
$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskZig = Join-Path $taskRepo 'tools/zig/zig-windows-x86_64-0.14.0/zig.exe'
$taskOut = Join-Path $taskRepo 'recorder/build/test-plane-damage.exe'
$taskFixture = Join-Path $taskRepo 'tools/opensa/captures/recorder-v11-damage-keys.csv'
New-Item -ItemType Directory -Force -Path (Split-Path $taskOut), (Split-Path $taskFixture) | Out-Null
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $taskRepo 'recorder/build/zig-cache-global'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $taskRepo 'recorder/build/zig-cache-local'
& $taskZig c++ -target x86-windows-gnu -O0 -o $taskOut (Join-Path $PSScriptRoot 'test-plane-damage.cpp') -lkernel32 -luser32
if ($LASTEXITCODE -ne 0) { throw "test compilation failed: $LASTEXITCODE" }
& $taskOut (Join-Path $taskRepo 'GTA San Andreas/gta_sa.exe') $taskFixture
if ($LASTEXITCODE -ne 0) { throw "damage tests failed: $LASTEXITCODE" }

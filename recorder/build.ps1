# Builds the standalone GTA SA recorder ASI (32-bit, x86-windows-gnu).
# No CLEO / no SCM opcode is used, so SA-MP 0.3.7-R5 can load it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$zig  = Join-Path $root 'tools\zig\zig-windows-x86_64-0.14.0\zig.exe'
if (-not (Test-Path $zig)) { throw "zig not found at $zig" }

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'build') | Out-Null
$out = Join-Path $PSScriptRoot 'build\FlightRecorder.asi'
& $zig c++ -target x86-windows-gnu -shared -O2 -o $out (Join-Path $PSScriptRoot 'src\FlightRecorderASI.cpp') -lkernel32 -luser32
if ($LASTEXITCODE -ne 0) { throw "zig build failed with $LASTEXITCODE" }

$bytes = [System.IO.File]::ReadAllBytes($out)
$pe = [BitConverter]::ToInt32($bytes, 0x3C)
$machine = [BitConverter]::ToUInt16($bytes, $pe + 4)
if ($machine -ne 0x14C) { throw ("expected i386 PE, got 0x{0:X4}" -f $machine) }
Write-Host ("built {0} ({1} bytes, i386)" -f $out, $bytes.Length)

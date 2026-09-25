# Builds the per-process game audio loopback capture helper with the in-box
# .NET Framework csc.exe (no dotnet SDK required).
$ErrorActionPreference = 'Stop'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe not found (need .NET Framework 4.x)' }

$src = Join-Path $PSScriptRoot 'GameAudioCapture.cs'
$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir 'GameAudioCapture.exe'

& $csc /nologo /target:exe /platform:x64 /optimize+ /out:$out $src
if ($LASTEXITCODE -ne 0) { throw "csc build failed with $LASTEXITCODE" }

$bytes = [System.IO.File]::ReadAllBytes($out)
$pe = [BitConverter]::ToInt32($bytes, 0x3C)
$machine = [BitConverter]::ToUInt16($bytes, $pe + 4)
if ($machine -ne 0x8664) { throw ("expected amd64 PE, got 0x{0:X4}" -f $machine) }
Write-Host ("built {0} ({1} bytes, x86-64)" -f $out, $bytes.Length)

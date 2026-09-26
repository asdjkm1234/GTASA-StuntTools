# Installs the freshly built recorder into the local game folder, with a backup.
param([string]$GameRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'GTA San Andreas'))
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'build\FlightRecorder.asi'
if (-not (Test-Path $source)) { throw "build FlightRecorder.asi first (run build.ps1)" }
$audioSource = Join-Path $PSScriptRoot 'build\GameAudioCapture.exe'
if (-not (Test-Path $audioSource)) { throw "build GameAudioCapture.exe first (run build.ps1)" }
$target = Join-Path $GameRoot 'FlightRecorder.asi'
$audioTarget = Join-Path $GameRoot 'GameAudioCapture.exe'

$backupDir = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
if (Test-Path $target) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    Copy-Item $target (Join-Path $backupDir "FlightRecorder.asi.$stamp.bak")
    Write-Host "backed up existing FlightRecorder.asi"
}
Copy-Item $source $target -Force
Write-Host "installed $target"
if (Test-Path $audioTarget) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    Copy-Item $audioTarget (Join-Path $backupDir "GameAudioCapture.exe.$stamp.bak")
    Write-Host "backed up existing GameAudioCapture.exe"
}
Copy-Item $audioSource $audioTarget -Force
Write-Host "installed $audioTarget"

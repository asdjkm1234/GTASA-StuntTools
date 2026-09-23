@echo off
rem Repair the EVERYDAY Chrome profile's WebGPU caches (reversible rename). Close ALL Chrome windows first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-chrome-webgpu.ps1"
pause

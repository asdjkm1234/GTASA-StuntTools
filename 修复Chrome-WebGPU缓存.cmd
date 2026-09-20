@echo off
rem Repairs the everyday Chrome profile's WebGPU caches (reversible rename).
rem Close ALL Chrome windows first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fix-chrome-webgpu.ps1"
pause

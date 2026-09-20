@echo off
rem Launches the replay in Chrome with the GPU blocklist ignored and WebGPU allowed.
rem Use this only when the normal page reports "WebGPU adapter request failed" because Chrome
rem blocklisted the GPU or rejected the high-performance adapter.
setlocal
set URL=http://127.0.0.1:4173/?local=latest
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% (
  echo Chrome not found in the usual locations. Open this URL manually in a current Chrome/Edge:
  echo %URL%
  pause
  exit /b 1
)
start "" %CHROME% --ignore-gpu-blocklist --enable-unsafe-webgpu --enable-features=Vulkan --disable-gpu-driver-bug-workarounds "%URL%"

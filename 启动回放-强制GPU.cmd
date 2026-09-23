@echo off
rem Open the replay in Chrome with the GPU blocklist ignored (fallback if WebGPU still complains).
setlocal
set URL=%1
if "%URL%"=="" set URL=http://127.0.0.1:4173/
set PROFILE=%TEMP%\GTASA-StuntTools-gpu-%RANDOM%%RANDOM%
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% (
  echo Chrome not found. Open this URL manually:
  echo %URL%
  pause
  exit /b 1
)
start "" %CHROME% --user-data-dir="%PROFILE%" --ignore-gpu-blocklist --enable-unsafe-webgpu --no-first-run --no-default-browser-check "%URL%"

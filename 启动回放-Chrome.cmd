@echo off
rem Opens the replay in Chrome/Edge with a FRESH throwaway profile (NOT the everyday one).
rem A profile's GPU caches can go bad and break WebGPU ("requestAdapter -> null"), and a reused profile can be
rem poisoned by a force-close; a new profile per launch avoids both. Measured: fresh profile -> Arc adapter OK.
setlocal
set URL=%1
if "%URL%"=="" set URL=http://127.0.0.1:4173/?local=latest
set PROFILE=%TEMP%\GTASA-StuntTools-chrome-%RANDOM%%RANDOM%
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %CHROME% (
  echo Chrome/Edge not found. Open this URL manually:
  echo %URL%
  pause
  exit /b 1
)
start "" %CHROME% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "%URL%"

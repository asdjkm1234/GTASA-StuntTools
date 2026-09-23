@echo off
rem Reset the DEDICATED replay browser profile (does NOT touch your everyday Chrome).
setlocal
set PROFILE=%LOCALAPPDATA%\GTASA-StuntTools\chrome-profiles
echo Closing the dedicated replay browsers (if any)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*GTASA-StuntTools*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul
if exist "%PROFILE%" (
  rmdir /s /q "%PROFILE%"
  echo Deleted %PROFILE%
) else (
  echo No dedicated profile found.
)
echo Done. Next launch will create a fresh profile.
pause

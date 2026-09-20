@echo off
rem Resets the DEDICATED replay browser profile. Use this if the replay again reports
rem "WebGPU 初始化失败" — the profile's cached GPU state can go bad and a fresh one fixes it.
rem It does NOT touch your everyday Chrome profile.
setlocal
set PROFILE=%LOCALAPPDATA%\GTASA-StuntTools\chrome-profile
echo Closing the dedicated replay browser (if running)...
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

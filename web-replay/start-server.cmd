@echo off
setlocal
cd /d "%~dp0"
set GAME_ROOT=%~dp0..\GTA San Andreas
echo Starting local replay server (http://127.0.0.1:4173/) ...
echo Keep THIS window open while you use the replay.
echo.
node local-server.mjs
echo.
echo Server exited. Press any key to close.
pause

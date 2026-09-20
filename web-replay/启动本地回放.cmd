@echo off
rem Starts the local replay service (OpenSA WebGPU build) for the user's own GTA install.
rem If port 4173 is already taken the server reports it and opens the running page instead of crashing.
cd /d "%~dp0"
set GAME_ROOT=%~dp0..\GTA San Andreas
node local-server.mjs
pause

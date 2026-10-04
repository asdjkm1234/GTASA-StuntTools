@echo off
rem Start the local replay service. ASCII-only (cmd reads BOM-less UTF-8 as ANSI and breaks otherwise).
cd /d "%~dp0web-replay"
call start-server.cmd

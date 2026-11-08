@echo off
title RTICORE Development Server
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
call npm.cmd run dev:local
pause

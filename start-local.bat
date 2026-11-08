@echo off
title RTICORE Local Server - Production Cepat
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo ========================================================
echo Menjalankan RTICORE mode cepat di http://127.0.0.1:3000
echo Database: PostgreSQL Lokal (.pgdata)
echo ========================================================
call node scripts\start-local-fast.mjs
pause

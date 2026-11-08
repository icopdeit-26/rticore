@echo off
title Git Auto-Push Watcher - RTICore
echo ========================================================
echo Memulai pemantauan folder RTICore...
echo Setiap perubahan akan otomatis di-push ke GitHub.
echo Biarkan jendela ini tetap terbuka di latar belakang.
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-push.ps1"
pause

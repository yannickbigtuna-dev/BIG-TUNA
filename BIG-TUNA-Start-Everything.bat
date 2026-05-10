@echo off
title BIG TUNA - Start Everything
cd /d C:\SERVER
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\SERVER\start-everything.ps1"
pause

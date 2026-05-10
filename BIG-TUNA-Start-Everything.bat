@echo off
title BIG TUNA - Start Everything
cd /d C:\SERVER
echo Starting apps-server, mcp-server, Cloudflare Tunnel, and git reloader.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\SERVER\start-everything.ps1"
pause

@echo off
title Cloudflare Service Installer

echo Checking admin rights...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo NOT running as admin. Please RIGHT-CLICK this file and choose "Run as administrator"
    pause
    exit /b 1
)

echo Running as admin - OK
echo.
echo Installing Cloudflare Tunnel as a Windows service...
"C:\Program Files (x86)\cloudflared\cloudflared.exe" service install --config "C:\SERVER\cloudflared-config.yml"
echo.
echo Starting service...
sc start cloudflared
echo.
echo --- SERVICE STATUS ---
sc query cloudflared
echo.
echo DONE. Tunnel will auto-start on every reboot.
pause

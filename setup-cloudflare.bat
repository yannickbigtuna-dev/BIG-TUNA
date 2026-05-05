@echo off
title Cloudflare Tunnel Setup
echo.
echo  ============================================================
echo    Cloudflare Tunnel Setup
echo    This will connect your domain to this PC
echo  ============================================================
echo.

:: Check for admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo  ERROR: Run this as Administrator!
    echo  Right-click this file and choose "Run as administrator"
    pause
    exit /b 1
)

:: Install cloudflared via winget
echo [1/4] Installing cloudflared...
winget install --id Cloudflare.cloudflared -e --silent
if %errorLevel% neq 0 (
    echo  winget failed. Trying manual download...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'C:\SERVER\cloudflared.exe'"
    if exist "C:\SERVER\cloudflared.exe" (
        echo  Downloaded cloudflared.exe to C:\SERVER\
        set CF_EXE=C:\SERVER\cloudflared.exe
    ) else (
        echo  Download failed. Please download manually from:
        echo  https://github.com/cloudflare/cloudflared/releases/latest
        pause
        exit /b 1
    )
) else (
    set CF_EXE=cloudflared
)

echo.
echo [2/4] Installing pm2 (keeps Node.js running forever)...
npm install -g pm2
npm install -g pm2-windows-startup

echo.
echo [3/4] Done installing tools!
echo.
echo  ============================================================
echo   NEXT STEPS (do these manually):
echo  ============================================================
echo.
echo  STEP 1: Login to Cloudflare (opens browser)
echo    Run: cloudflared tunnel login
echo.
echo  STEP 2: Create a tunnel (replace MY-TUNNEL with any name)
echo    Run: cloudflared tunnel create MY-TUNNEL
echo.
echo  STEP 3: Edit C:\SERVER\cloudflared-config.yml
echo    Fill in your tunnel ID and domain name
echo.
echo  STEP 4: Run C:\SERVER\start-all.bat as Administrator
echo.
echo  See C:\SERVER\SETUP-GUIDE.md for full instructions
echo  ============================================================
echo.
pause

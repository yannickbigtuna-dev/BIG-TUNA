@echo off
title Install Server as Windows Services (Auto-Start on Boot)
echo.
echo  ============================================================
echo    Installing as Windows Services
echo    Server and Tunnel will start automatically on boot
echo  ============================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo  ERROR: Run as Administrator!
    pause
    exit /b 1
)

echo [1/2] Installing Cloudflare Tunnel as Windows service...
cloudflared service install --config "C:\SERVER\cloudflared-config.yml"
sc start cloudflared
echo  Cloudflare Tunnel service installed and started.

echo.
echo [2/2] Setting up pm2 to auto-start on Windows login...
pm2 start "C:\SERVER\server.js" --name "apps-server"
pm2 save
pm2-startup install
echo  pm2 startup configured.

echo.
echo  ============================================================
echo   DONE! Both services will now start automatically on boot.
echo.
echo   To check status:
echo     pm2 status
echo     sc query cloudflared
echo.
echo   To stop everything:
echo     pm2 stop apps-server
echo     sc stop cloudflared
echo  ============================================================
echo.
pause

@echo off
title Start Server + Cloudflare Tunnel
echo.
echo  ============================================================
echo    Starting Apps Server + Cloudflare Tunnel
echo  ============================================================
echo.

:: Start Node.js server with pm2
echo [1/2] Starting Node.js server with pm2...
pm2 start "C:\SERVER\server.js" --name "apps-server" --watch false
pm2 save
echo  Node.js server started on http://localhost:3000

echo.
echo [2/2] Starting Cloudflare Tunnel...
start "Cloudflare Tunnel" cloudflared tunnel --config "C:\SERVER\cloudflared-config.yml" run
echo  Cloudflare Tunnel started

echo.
echo  ============================================================
echo   Server is live at your Cloudflare domain!
echo   Check tunnel status: cloudflared tunnel info
echo  ============================================================
echo.
pause

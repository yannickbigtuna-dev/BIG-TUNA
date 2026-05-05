@echo off
:: Auto-start: Node.js server + Cloudflare Tunnel
:: Runs silently in background on Windows login

:: Start Node.js server via pm2
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "pm2 start 'C:\SERVER\server.js' --name 'apps-server' 2>$null; pm2 save 2>$null"

:: Wait a moment for pm2 to start
timeout /t 3 /nobreak >nul

:: Start Cloudflare Tunnel (hidden window)
start "" /min "C:\SERVER\cloudflared.exe" tunnel --config "C:\SERVER\cloudflared-config.yml" run

@echo off
title Cloudflare Login
echo.
echo  Opening Cloudflare login in your browser...
echo  Log in, then CLICK "yannickmorgans.ca" to authorize.
echo.
echo  This window will close automatically when done.
echo  (It may take 30-60 seconds)
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel login
echo.
echo  LOGIN COMPLETE! You can close this window.
pause

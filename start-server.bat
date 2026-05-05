@echo off
title My Apps Server
echo.
echo  ========================================
echo    My Apps Server
echo    Local:  http://localhost:3000
echo    Remote: https://yannickmorgans.ca
echo  ========================================
echo.
echo  Scan to access from your phone:
echo.
curl -s "qrenco.de/https://yannickmorgans.ca"
echo.
echo  ========================================
echo.
"C:\Program Files\nodejs\node.exe" "C:\SERVER\server.js"
pause

@echo off
echo Adding firewall rule for port 80...
netsh advfirewall firewall add rule name="My Apps Server Port 3000" dir=in action=allow protocol=TCP localport=3000
echo.
echo Done! You can close this window.
pause

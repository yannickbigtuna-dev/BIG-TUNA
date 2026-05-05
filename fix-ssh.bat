@echo off
title Fix SSH — Auto-Start + Cloudflare Tunnel Route
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo  ERROR: Run as Administrator!
    pause
    exit /b 1
)

echo [1/3] Setting sshd to auto-start on boot...
sc config sshd start= auto
echo  Done.

echo.
echo [2/3] Starting sshd now...
sc start sshd
echo  Done.

echo.
echo [3/3] Adding DNS route for ssh.yannickmorgans.ca and restarting tunnel...
cloudflared tunnel route dns my-server ssh.yannickmorgans.ca
sc stop cloudflared
timeout /t 3 >nul
sc start cloudflared
echo  Done.

echo.
echo  ============================================================
echo   SSH is now routed through Cloudflare Tunnel.
echo.
echo   From your other laptop, connect with:
echo     ssh -o "ProxyCommand=cloudflared access ssh --hostname %%h" yanni@ssh.yannickmorgans.ca
echo.
echo   Or add this to ~/.ssh/config on the other laptop:
echo     Host ssh.yannickmorgans.ca
echo       ProxyCommand cloudflared access ssh --hostname %%h
echo   Then just: ssh yanni@ssh.yannickmorgans.ca
echo  ============================================================
echo.
pause

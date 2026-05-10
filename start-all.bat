@echo off
title BIG TUNA - Start Everything
echo.
echo  ============================================================
echo    Starting BIG TUNA services
echo  ============================================================
echo.
echo  Includes apps-server, mcp-server, Cloudflare Tunnel, and git reloader.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\SERVER\start-everything.ps1"

echo.
echo  ============================================================
echo   BIG TUNA startup command finished.
echo  ============================================================
echo.
pause

@echo off
cd /d C:\SERVER\mcp-server

echo.
echo  =========================================
echo   MCP Server Setup
echo  =========================================
echo.

:: Install dependencies
echo  Installing dependencies...
call npm install
if errorlevel 1 (
  echo  ERROR: npm install failed.
  pause
  exit /b 1
)

:: Generate token if one doesn't exist yet
if not exist token.txt (
  for /f %%A in ('node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"') do (
    echo %%A > token.txt
  )
  echo  Generated new secret token.
) else (
  echo  Token already exists (token.txt).
)

:: Start with pm2
pm2 delete mcp-server 2>nul
pm2 start ecosystem.config.cjs
pm2 save

:: Read and display the token
for /f "usebackq tokens=*" %%A in ("token.txt") do set TOKEN=%%A

echo.
echo  =========================================
echo   SETUP COMPLETE
echo  =========================================
echo.
echo  MCP server is running at:
echo  https://mcp.yannickmorgans.ca/mcp
echo.
echo  Your secret token:
echo  %TOKEN%
echo.
echo  Add to Claude mobile app:
echo    URL:   https://mcp.yannickmorgans.ca/mcp
echo    Header: Authorization: Bearer %TOKEN%
echo.
echo  IMPORTANT: Also add the DNS record for
echo  mcp.yannickmorgans.ca in Cloudflare, then
echo  restart the tunnel:
echo    sc stop cloudflared ^& sc start cloudflared
echo.
pause

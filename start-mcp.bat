@echo off
cd /d C:\SERVER\mcp-server

:: Load token from config file
for /f "usebackq tokens=*" %%A in ("C:\SERVER\mcp-server\token.txt") do set MCP_SECRET=%%A

echo.
echo  Starting MCP server...
echo  Token loaded from C:\SERVER\mcp-server\token.txt
echo.

pm2 start server.js --name mcp-server --interpreter node -- && (
  pm2 save
  echo.
  echo  MCP server started!
  echo  URL:   https://mcp.yannickmorgans.ca/mcp
  echo.
)
pause

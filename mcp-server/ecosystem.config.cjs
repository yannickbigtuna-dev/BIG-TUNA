const { readFileSync } = require("fs");
const { join } = require("path");

const tokenFile = join(__dirname, "token.txt");
let secret;
try {
  secret = readFileSync(tokenFile, "utf8").trim();
} catch {
  console.error("ERROR: token.txt not found. Run setup-mcp.bat first.");
  process.exit(1);
}

module.exports = {
  apps: [
    {
      name: "mcp-server",
      script: "server.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        MCP_SECRET: secret,
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};

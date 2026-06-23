// PM2 config for the main app server (apps-server, port 3000).
//
// Secrets are NOT stored here. Put them in a gitignored `server.env` file
// next to this config (copy `server.env.example` to `server.env` and fill it
// in). This mirrors how mcp-server/ecosystem.config.cjs loads its secret.
//
// Start / apply env changes:
//   pm2 start   ecosystem.config.cjs
//   pm2 restart ecosystem.config.cjs --update-env   # after editing server.env

const { readFileSync } = require('fs');
const { join } = require('path');

function loadEnvFile(file) {
  const env = {};
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    console.warn(`[apps-server] ${file} not found — using only existing system env vars.`);
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

module.exports = {
  apps: [
    {
      name: 'apps-server',
      script: 'server.js',
      cwd: __dirname,
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: loadEnvFile(join(__dirname, 'server.env')),
    },
  ],
};

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'start-everything.ps1');

test('main PM2 restart reloads its ecosystem environment while MCP stays independent', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /& \$pm2 @RestartArgs/);
  assert.match(
    script,
    /Invoke-Pm2App -Name 'apps-server' -StartArgs @\('start', 'C:\\SERVER\\ecosystem\.config\.cjs', '--update-env'\) -RestartArgs @\('restart', 'C:\\SERVER\\ecosystem\.config\.cjs', '--only', 'apps-server', '--update-env'\)/,
  );
  assert.match(
    script,
    /Invoke-Pm2App -Name 'mcp-server' -StartArgs @\('start', 'C:\\SERVER\\mcp-server\\ecosystem\.config\.cjs'\) -RestartArgs @\('restart', 'mcp-server'\)/,
  );
  assert.doesNotMatch(script, /-Name 'mcp-server'[\s\S]*?RestartArgs @\('restart', 'C:\\SERVER\\ecosystem\.config\.cjs'/);
});

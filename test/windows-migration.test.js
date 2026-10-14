'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Parse only: invoking either entry point would stop the owner's live services.
test('Windows cutover and rollback scripts parse in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  const directory = path.resolve(__dirname, '../tools/windows-migration');
  const script = `
    $ErrorActionPreference = 'Stop'
    $files = Get-ChildItem -LiteralPath '${directory.replace(/'/g, "''")}' -Filter '*.ps1'
    if ($files.Count -lt 2) { throw 'Missing cutover scripts' }
    foreach ($file in $files) {
      $tokens = $null; $parseErrors = $null
      $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
      if ($parseErrors.Count -ne 0) { throw ($file.Name + ': ' + (($parseErrors | ForEach-Object Message) -join '; ')) }
    }
    Write-Output 'PARSE_OK'
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PARSE_OK/);
});

test('Finder-style Windows launchers reference their existing adjacent scripts with quoted paths', () => {
  const directory = path.resolve(__dirname, '../tools/windows-migration');
  for (const name of ['Export-Final', 'Resume-Windows']) {
    const cmd = fs.readFileSync(path.join(directory, `${name}.cmd`), 'utf8');
    assert.ok(fs.existsSync(path.join(directory, `${name}.ps1`)));
    assert.match(cmd, new RegExp(`-File "%~dp0${name}\\.ps1"`, 'i'));
  }
});

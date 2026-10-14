'use strict';
// pty-worker.js — isolated child process for one terminal session.
// A native crash here only kills this session, not the main server.

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function terminalOptions(env = process.env, platform = process.platform) {
  const windows = platform === 'win32';
  return {
    executable: env.BIG_TUNA_TERMINAL_SHELL || (windows ? POWERSHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/bash'),
    args: windows ? ['-NoLogo'] : ['-l'],
    cwd: env.BIG_TUNA_TERMINAL_CWD || env.BIG_TUNA_ROOT || __dirname,
    ...(windows ? { useConpty: false } : {}),
  };
}

module.exports = { terminalOptions };

if (require.main === module) {
const pty = require('node-pty');
let shell = null;

process.on('message', msg => {
  if (msg.type === 'start') {
    try {
      const { executable, args, ...options } = terminalOptions();
      shell = pty.spawn(executable, args, {
        name: 'xterm-256color',
        cols: msg.cols || 220,
        rows: msg.rows || 50,
        env: process.env,
        ...options,
      });
    } catch (err) {
      process.send({ type: 'error', message: err.message });
      process.exit(1);
      return;
    }

    shell.onData(data => {
      try { process.send({ type: 'data', data }); } catch {}
    });

    shell.onExit(() => {
      try { process.send({ type: 'exit' }); } catch {}
      process.exit(0);
    });

  } else if (msg.type === 'input' && shell) {
    try { shell.write(msg.data); } catch {}

  } else if (msg.type === 'resize' && shell) {
    try { shell.resize(msg.cols, msg.rows); } catch {}

  } else if (msg.type === 'kill') {
    try { if (shell) shell.kill(); } catch {}
    process.exit(0);
  }
});

// Ensure we exit if the parent dies
process.on('disconnect', () => process.exit(0));
}

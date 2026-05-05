'use strict';
// pty-worker.js — isolated child process for one terminal session.
// A native crash here only kills this session, not the main server.

const pty = require('node-pty');

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

let shell = null;

process.on('message', msg => {
  if (msg.type === 'start') {
    try {
      shell = pty.spawn(POWERSHELL, ['-NoLogo'], {
        name: 'xterm-256color',
        cols: msg.cols || 220,
        rows: msg.rows || 50,
        cwd: 'C:\\SERVER',
        env: process.env,
        useConpty: false,
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

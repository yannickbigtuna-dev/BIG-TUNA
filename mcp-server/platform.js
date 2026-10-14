import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function runtimeConfig(env = process.env, platform = process.platform) {
  const root = env.MCP_ROOT || (platform === 'win32' ? 'C:\\SERVER' : fileURLToPath(new URL('../', import.meta.url)));
  return {
    root: path.resolve(root),
    shell: platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    host: env.BIG_TUNA_STAGING === '1' ? '127.0.0.1' : '0.0.0.0',
  };
}

export function isWithinRoot(root, candidate, pathApi = path) {
  const relative = pathApi.relative(root, candidate);
  return relative === '' || (!pathApi.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`));
}

// The root is owner-controlled. Reject link components, including dangling links,
// before reads/writes; checking only string prefixes permits sibling and link escapes.
// This assumes another local process is not concurrently replacing path components.
export function createSafePath(root) {
  const lexicalRoot = path.resolve(root);
  const realRoot = fs.realpathSync(lexicalRoot);
  return p => {
    if (typeof p !== 'string' || p.includes('\0')) throw new Error('Invalid server path');
    const absolute = path.resolve(lexicalRoot, p);
    if (!isWithinRoot(lexicalRoot, absolute)) throw new Error('Path outside server root');
    let current = realRoot;
    const parts = path.relative(lexicalRoot, absolute).split(path.sep).filter(Boolean);
    for (const part of parts) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink() || !isWithinRoot(realRoot, fs.realpathSync(current))) {
        throw new Error('Links outside or within server paths are not permitted');
      }
    }
    return path.resolve(realRoot, ...parts);
  };
}

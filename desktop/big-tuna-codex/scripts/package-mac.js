const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { packager } = require('@electron/packager');

const root = path.resolve(__dirname, '..');
const downloadsDir = path.resolve(root, '..', '..', 'apps', 'terminal', 'downloads');
const workDir = path.join(downloadsDir, 'package-work');
const zipPath = path.join(downloadsDir, 'big-tuna-codex-mac.zip');

async function main() {
  if (process.platform !== 'darwin') {
    console.error('macOS packaging must run on macOS so Electron framework symlinks are preserved.');
    process.exit(1);
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  const appPaths = await packager({
    dir: root,
    name: 'BIG TUNA Codex',
    platform: 'darwin',
    arch: 'universal',
    out: workDir,
    overwrite: true,
    asar: true,
    prune: true,
    appBundleId: 'ca.yannickmorgans.bigtuna.codex',
    extendInfo: {
      LSMinimumSystemVersion: '12.0.0',
    },
    ignore: [
      /^\/scripts($|\/)/,
      /^\/node_modules\/electron($|\/)/,
      /^\/node_modules\/@electron($|\/)/,
    ],
  });

  const appPath = appPaths[0];
  fs.rmSync(zipPath, { force: true });

  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath], { stdio: 'inherit' });

  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`Created ${zipPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

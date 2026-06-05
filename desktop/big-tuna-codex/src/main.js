const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');

const APP_NAME = 'BIG TUNA Codex';

function escapeAppleScriptString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildLauncherScript() {
  return [
    'set -u',
    'SCRIPT_PATH="$0"',
    'trap \'rm -f "$SCRIPT_PATH"\' EXIT',
    'REPO_PATH="$HOME/BIG-TUNA"',
    'REPO_URL="https://github.com/yannickbigtuna-dev/BIG-TUNA.git"',
    '',
    'pause_on_error() {',
    '  status="$1"',
    '  if [ "$status" -ne 0 ]; then',
    '    printf "\\nPress return to close this window..."',
    '    read -r _',
    '  fi',
    '  return "$status"',
    '}',
    '',
    'main() {',
    '  clear',
    '  printf "\\nBIG TUNA Codex launcher\\n\\n"',
    '',
    '  if ! command -v git >/dev/null 2>&1; then',
    '    echo "git is required but was not found."',
    '    echo "Install Xcode Command Line Tools and reopen this app."',
    '    return 1',
    '  fi',
    '',
    '  if ! command -v codex >/dev/null 2>&1; then',
    '    echo "Codex CLI was not found on PATH."',
    '    echo "Install Codex CLI and reopen this app."',
    '    return 1',
    '  fi',
    '',
    '  if [ -d "$REPO_PATH/.git" ]; then',
    '    echo "Using existing repo at $REPO_PATH"',
    '  elif [ -e "$REPO_PATH" ]; then',
    '    echo "$REPO_PATH exists but is not a git repository."',
    '    echo "Move it aside or clone BIG-TUNA there manually."',
    '    return 1',
    '  else',
    '    echo "Cloning BIG-TUNA into $REPO_PATH..."',
    '    git clone "$REPO_URL" "$REPO_PATH" || return $?',
    '  fi',
    '',
    '  cd "$REPO_PATH" || return 1',
    '',
    '  echo "Pulling latest changes..."',
    '  git pull origin main || {',
    '    echo',
    '    echo "git pull failed. Fix the Git error above before starting Codex."',
    '    return 1',
    '  }',
    '',
    '  echo',
    '  echo "Starting Codex inside BIG-TUNA with full repo permissions..."',
    '  echo "This allows Codex to commit and push. Only use this for repos you trust."',
    '  echo',
    '',
    '  codex --cd "$REPO_PATH" --sandbox danger-full-access --ask-for-approval never',
    '}',
    '',
    'main',
    'pause_on_error $?',
  ].join('\n');
}

function createLauncherScriptFile() {
  const scriptPath = path.join(os.tmpdir(), `big-tuna-codex-${Date.now()}.sh`);
  fs.writeFileSync(scriptPath, buildLauncherScript(), { encoding: 'utf8', mode: 0o700 });
  return scriptPath;
}

function openTerminal(scriptPath) {
  const scriptLines = [
    'tell application "Terminal"',
    'activate',
    `do script ${escapeAppleScriptString(`/bin/bash ${JSON.stringify(scriptPath)}`)}`,
    'end tell',
  ];

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', scriptLines.flatMap(line => ['-e', line]), error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main() {
  if (process.platform !== 'darwin') {
    dialog.showErrorBox(APP_NAME, 'This launcher only works on macOS.');
    app.quit();
    return;
  }

  if (app.dock) app.dock.hide();

  try {
    const scriptPath = createLauncherScriptFile();
    await openTerminal(scriptPath);
  } catch (error) {
    dialog.showErrorBox(
      APP_NAME,
      `Could not open Terminal.app.\n\n${error.message}`
    );
  } finally {
    app.quit();
  }
}

app.whenReady().then(main);

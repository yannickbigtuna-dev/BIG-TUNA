#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  fail 'Finish Apple Command Line Tools installation, then run Setup.command again.'
fi
if [ ! -x /opt/homebrew/bin/brew ]; then
  printf 'Installing Homebrew from its official installer. macOS may ask for your administrator password.\n'
  INSTALLER="$(mktemp)"
  /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$INSTALLER"
  /bin/bash "$INSTALLER"
  rm -f "$INSTALLER"
fi
/opt/homebrew/bin/brew install node@24 git gh cloudflared
/opt/homebrew/bin/brew install --cask google-chrome
[ -x '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ] || fail 'Google Chrome executable was not installed at the expected path.'
mkdir -p "$BASE/control/runtime" "$BASE/generations"
/opt/homebrew/opt/node@24/bin/npm install --prefix "$BASE/control/runtime" pm2@6 --no-audit --no-fund
node_ready
printf 'Optional local AI: install Ollama now? No models will be downloaded. [y/N] '; IFS= read -r ANSWER
if [ "$ANSWER" = y ] || [ "$ANSWER" = Y ]; then /opt/homebrew/bin/brew install ollama; fi
printf 'Homebrew Google Chrome may need one-time approval in Privacy & Security. Keep at least 40 GB free for Xcode/simulators.\n'
restore_bundle

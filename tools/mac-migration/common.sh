#!/bin/bash
set -euo pipefail
umask 077
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$HOME/BigTuna"
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ=America/Halifax
export COPYFILE_DISABLE=1
export PM2_HOME="$BASE/control/pm2"
fail() { printf '%s\n' "$*" >&2; exit 1; }
safe_base() { local p; for p in "$BASE" "$BASE/control" "$BASE/generations" "$BASE/control/pm2" "$BASE/control/runtime"; do [ ! -L "$p" ] || fail 'Migration storage must not use symlinked base/control/generation folders.'; done; }
safe_base
mac_only() { [ "$(uname -s)" = Darwin ] || fail 'Run this kit on the Mac, not Windows.'; [ "$(uname -m)" = arm64 ] || fail 'Run Terminal natively on Apple Silicon (turn off Open using Rosetta).'; }
node_ready() { NODE="/opt/homebrew/opt/node@24/bin/node"; [ -x "$NODE" ] || fail 'Run Setup.command first to install Node 24.'; PM2="$BASE/control/runtime/node_modules/pm2/bin/pm2"; [ -f "$PM2" ] || fail 'Run Setup.command first to install PM2.'; }
pm2_run() { "$NODE" "$PM2" "$@"; }
current() { [ -f "$BASE/control/current" ] && [ ! -L "$BASE/control/current" ] || fail 'Restore a bundle first.'; IFS= read -r GENERATION < "$BASE/control/current"; case "$GENERATION" in "$BASE"/generations/*) ;; *) fail 'Invalid generation state.';; esac; local name="${GENERATION#"$BASE/generations/"}"; [[ "$name" =~ ^[a-zA-Z0-9-]+$ ]] || fail 'Invalid generation name.'; [ -d "$GENERATION" ] && [ ! -L "$GENERATION" ] || fail 'Missing or linked generation.'; }
label() { LABEL="com.bigtuna.$(id -u)"; PLIST="/Library/LaunchDaemons/$LABEL.plist"; }
stop_all() {
  label
  if launchctl print "system/$LABEL" >/dev/null 2>&1; then sudo launchctl bootout "system/$LABEL"; fi
  # Removing the installed registration is essential: bootout alone lasts only until reboot.
  [ ! -L "$PLIST" ] || fail 'Refusing a symlinked boot plist. Review its ownership before continuing.'
  if [ -f "$PLIST" ]; then sudo rm -f -- "$PLIST"; [ ! -e "$PLIST" ] || fail 'Boot registration was not removed; do not resume Windows.'; fi
  if [ -d "$PM2_HOME" ]; then pm2_run kill; fi
}
restore_bundle() {
  [ ! -f "$BASE/control/active" ] || fail 'Production is active. Stop it before restoring a new generation.'
  printf 'Select the encrypted migration bundle in the file chooser.\n'
  BUNDLE="$(/usr/bin/osascript -e 'POSIX path of (choose file with prompt "Select the encrypted BIG TUNA migration bundle")')" || fail 'Bundle selection cancelled.'
  [ -f "$BUNDLE" ] || fail 'Bundle file not found.'
  mkdir -p "$BASE/generations" "$BASE/control"
  local work; work="$(mktemp -d "$BASE/.restore.XXXXXX")"
  local cleanup; printf -v cleanup 'rm -rf -- %q' "$work"; trap "$cleanup" EXIT
  local bytes free required; bytes="$(stat -f %z "$BUNDLE")"; free="$(df -Pk "$BASE" | awk 'NR==2 {printf "%.0f", $4*1024}')"; required=$((bytes * 3 + 15 * 1024 * 1024 * 1024))
  [ "$free" -gt "$required" ] || fail 'Not enough free disk space: reserve three times bundle size plus 15 GB for dependencies. Xcode needs additional space.'
  printf 'Paste the separate recovery key (hidden), then Return: '; IFS= read -rs KEY; printf '\n'
  printf '%s\n' "$KEY" | "$NODE" "$KIT/migration/crypto.cjs" decrypt "$BUNDLE" "$work/payload.tar"; unset KEY
  "$NODE" "$KIT/migration/validate.cjs" archive "$work/payload.tar"
  mkdir "$work/content"
  /usr/bin/tar -xf "$work/payload.tar" -C "$work/content"
  "$NODE" "$KIT/migration/validate.cjs" "$work/content"
  GENERATION="$BASE/generations/$(date +%Y%m%d-%H%M%S)-$(uuidgen | tr '[:upper:]' '[:lower:]')"
  mv "$work/content" "$GENERATION"
  chmod -R go-rwx "$GENERATION"
  printf 'Ethernet interface for HomeKit (usually en0; inspect networksetup -listallhardwareports), enter name: '; IFS= read -r ETHERNET
  [[ "$ETHERNET" =~ ^en[0-9]+$ ]] || fail 'Enter a hardware interface name such as en0.'
  /sbin/ifconfig "$ETHERNET" >/dev/null || fail 'That network interface does not exist.'
  "$NODE" "$KIT/helper.cjs" prepare "$GENERATION" "$NODE" '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "$ETHERNET"
  export PUPPETEER_SKIP_DOWNLOAD=true
  (cd "$GENERATION/SERVER" && /opt/homebrew/opt/node@24/bin/npm ci --no-audit --no-fund)
  (cd "$GENERATION/SERVER/mcp-server" && /opt/homebrew/opt/node@24/bin/npm ci --no-audit --no-fund)
  # Replace preview processes only after validation/config/dependency installation succeeds.
  # Clear even an orphaned installed boot job whose active marker was lost.
  stop_all
  printf '%s\n' "$GENERATION" > "$BASE/control/current"
  pm2_run start "$GENERATION/control/staging.json"
  printf '\nRestored safely. Preview: http://127.0.0.1:3000 . No tunnel, HomeKit or scheduled jobs.\n'
  open 'http://127.0.0.1:3000'
  rm -rf -- "$work"
  trap - EXIT
}

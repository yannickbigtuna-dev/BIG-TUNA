#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
"$NODE" "$KIT/helper.cjs" final "$GENERATION"
printf 'Confirm Windows server, MCP, tunnel and updater are STOPPED, final snapshot restored, and this Mac will become production. Type ACTIVATE: '; IFS= read -r ANSWER
[ "$ANSWER" = ACTIVATE ] || fail 'Activation cancelled.'
stop_all
rm -f "$BASE/control/active"
label
"$NODE" -e 'const fs=require("fs"); const [out,node,pm2,home,owner,label]=process.argv.slice(1); fs.writeFileSync(out,JSON.stringify({node,pm2,home,owner,label,log:home+"/BigTuna/control/launchd.log"}),{mode:384})' "$BASE/control/launchd-settings.json" "$NODE" "$PM2" "$HOME" "$(id -un)" "$LABEL"
"$NODE" "$KIT/helper.cjs" plist "$BASE/control/$LABEL.plist" "$BASE/control/launchd-settings.json"
/usr/bin/plutil -lint "$BASE/control/$LABEL.plist"
activation_failed() {
  trap - EXIT
  printf 'Activation did not finish. Stopping Mac services and removing this boot registration; Windows must stay stopped until you decide how to recover.\n' >&2
  if launchctl print "system/$LABEL" >/dev/null 2>&1; then sudo launchctl bootout "system/$LABEL" || true; fi
  pm2_run kill || true
  if [ -f "$PLIST" ]; then sudo rm -f -- "$PLIST" || printf 'Could not remove boot plist; do not reboot before running Stop.command and reviewing this registration.\n' >&2; fi
  rm -f "$BASE/control/active"
}
trap activation_failed EXIT
pm2_run start "$GENERATION/control/production.json"
pm2_run save
"$NODE" "$KIT/helper.cjs" check-dump "$GENERATION" "$PM2_HOME/dump.pm2"
pm2_run kill
sudo install -o root -g wheel -m 644 "$BASE/control/$LABEL.plist" "$PLIST"
# A desktop server must not fall asleep while hosting. Display sleep remains independent.
sudo /usr/bin/pmset -a sleep 0
sudo /usr/bin/pmset -a autorestart 1 || printf 'Enable automatic restart after power failure in System Settings where supported.\n'
sudo launchctl bootstrap system "$PLIST"
sudo launchctl print "system/$LABEL" >/dev/null
printf '%s\n' "$GENERATION" > "$BASE/control/active"
trap - EXIT
printf 'Production boot service registered: all configured web, MCP, tunnel and Ollama services automatically start without opening this kit or signing in, once the system volume is unlocked. Automatic sleep is disabled. Run Verify.command now, restart the Mac, then run Reboot-Check.command before retiring Windows. FileVault can require owner unlock after restart/power loss. SSH remote login is deliberately a separate macOS setting.\n'

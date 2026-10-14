#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
[ -f "$BASE/control/active" ] || fail 'Production is not marked active. Complete Activate.command first.'
label
launchctl print "system/$LABEL" >/dev/null || fail 'Boot service is not loaded. Review launchd.log and run Activate.command to repair it.'
"$NODE" "$KIT/helper.cjs" check-dump "$GENERATION" "$PM2_HOME/dump.pm2"
/bin/bash "$KIT/Verify.command"
printf 'Boot registration, persisted production process set and live service checks passed. Confirm your public domain and physical devices from another device. Run this AFTER an actual Mac restart to prove reboot recovery; the script cannot determine whether you have restarted.\n'

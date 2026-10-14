#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
pm2_run list
"$NODE" "$KIT/helper.cjs" verify "$GENERATION" "$NODE" "$PM2"
if [ -f "$BASE/control/active" ]; then label; launchctl print "system/$LABEL" >/dev/null || fail 'Production launchd job is not loaded.'; fi
/usr/bin/curl --fail --silent --output /dev/null http://127.0.0.1:3000/
PUPPETEER_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "$NODE" -e 'const p=require(process.argv[1]+"/node_modules/puppeteer"); (async()=>{const b=await p.launch({headless:true}); try{const page=await b.newPage(); await page.setContent("<title>BigTuna smoke</title>"); if(await page.title()!=="BigTuna smoke") throw Error("Google Chrome page failed"); console.log("Google Chrome smoke check passed");}finally{await b.close();}})().catch(()=>{console.error("Google Chrome smoke check failed: approve Google Chrome in Privacy & Security and inspect compatibility before enabling Brightspace");process.exitCode=1;});' "$GENERATION/SERVER"
"$NODE" -e 'const r=require(process.argv[1]); console.log("Snapshot:",r.consistency)' "$GENERATION/control/restore-receipt.json"
printf 'Web HTTP check passed. Open preview and manually verify login, saved records, apps and browser reauthentication. Production also needs LAN devices, HomeKit, scheduler/email and reboot verification.\n'
open 'http://127.0.0.1:3000'

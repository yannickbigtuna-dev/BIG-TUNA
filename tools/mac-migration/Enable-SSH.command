#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
printf 'In System Settings → General → Sharing enable Remote Login, restrict access to your owner account, and install/review your SSH authorized_keys. Type SSH after completing this: '; IFS= read -r ANSWER
[ "$ANSWER" = SSH ] || fail 'SSH setup cancelled.'
/usr/bin/nc -z -w 3 127.0.0.1 22 || fail 'SSH is not listening on localhost port 22.'
"$NODE" -e 'const fs=require("fs");const p=process.argv[1];const text=fs.readFileSync(p+"/cloudflared-with-ssh.yml","utf8");if(!text.includes("ssh://localhost:22"))throw Error("Original export has no SSH ingress");fs.writeFileSync(p+"/cloudflared.yml",text,{mode:384});' "$GENERATION/control"
if [ -f "$BASE/control/active" ]; then pm2_run restart bigtuna-tunnel; pm2_run save; fi
printf 'Original Cloudflare SSH ingress restored. Verify access from your usual client. A future generation restore requires this deliberate SSH enable step again.\n'

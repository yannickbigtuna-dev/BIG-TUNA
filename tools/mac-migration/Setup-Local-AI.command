#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
printf 'Restore your two existing Eco AI models (llama3.1:8b and qwen2.5-coder:7b)? Allow about 12 GB additional disk and run one model at a time on 16 GB RAM. Type MODELS: '; IFS= read -r ANSWER
[ "$ANSWER" = MODELS ] || fail 'Local AI setup cancelled.'
/opt/homebrew/bin/brew install ollama
FREE="$(df -Pk "$BASE" | awk 'NR==2 {printf "%.0f", $4*1024}')"
[ "$FREE" -gt 20000000000 ] || fail 'Keep at least 20 GB free before downloading models.'
# Own Ollama through the isolated PM2 daemon; do not duplicate a brew service.
/opt/homebrew/bin/brew services stop ollama || true
pm2_run delete bigtuna-ollama >/dev/null 2>&1 || true
OLLAMA_HOST=127.0.0.1:11434 pm2_run start /opt/homebrew/bin/ollama --name bigtuna-ollama --interpreter none -- serve
for attempt in 1 2 3 4 5; do if /usr/bin/curl -fsS -o /dev/null http://127.0.0.1:11434/api/tags; then break; fi; sleep 2; done
/opt/homebrew/bin/ollama pull llama3.1:8b
/opt/homebrew/bin/ollama pull qwen2.5-coder:7b
# Add Ollama to production config without regenerating preserved configurations.
"$NODE" -e 'const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p));if(!c.apps.some(a=>a.name==="bigtuna-ollama"))c.apps.push({name:"bigtuna-ollama",script:"/opt/homebrew/bin/ollama",interpreter:"none",args:["serve"],env:{HOME:process.env.HOME,OLLAMA_HOST:"127.0.0.1:11434",TZ:"America/Halifax"},autorestart:true});fs.writeFileSync(p,JSON.stringify(c,null,2),{mode:384});' "$GENERATION/control/production.json"
if [ -f "$BASE/control/active" ]; then pm2_run save; fi
printf 'Eco AI models installed. Their existing names/settings are preserved. Verify a chat before relying on them.\n'

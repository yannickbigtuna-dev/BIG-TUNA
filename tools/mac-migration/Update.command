#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
REPO="$GENERATION/SERVER"
[ -z "$(/opt/homebrew/bin/git -C "$REPO" status --porcelain)" ] || fail 'Local changes exist (migration preserves unfinished work). Review/commit them locally before updating. No pull was attempted.'
[ "$(/opt/homebrew/bin/git -C "$REPO" branch --show-current)" = main ] || fail 'Updater requires main.'
printf 'Fetch and fast-forward this clean main checkout, reinstall dependencies, leave services stopped? Type UPDATE: '; IFS= read -r ANSWER
[ "$ANSWER" = UPDATE ] || fail 'Update cancelled.'
stop_all
rm -f "$BASE/control/active"
/opt/homebrew/bin/git -C "$REPO" fetch origin main
/opt/homebrew/bin/git -C "$REPO" merge --ff-only origin/main
export PUPPETEER_SKIP_DOWNLOAD=true
(cd "$REPO" && /opt/homebrew/opt/node@24/bin/npm ci --no-audit --no-fund)
(cd "$REPO/mcp-server" && /opt/homebrew/opt/node@24/bin/npm ci --no-audit --no-fund)
printf 'Update complete. Services remain stopped. Review changes then run Activate.command. This updater is manual and opt-in; no scheduled Git changes.\n'

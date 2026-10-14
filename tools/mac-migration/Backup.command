#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
current
printf 'Close all APPS/SERVER editors, Codex chats, builds and other writers first. Backup stops Mac services and verifies source stability. Type BACKUP to confirm ALL other writers are stopped: '; IFS= read -r ANSWER
[ "$ANSWER" = BACKUP ] || fail 'Backup cancelled.'
stop_all
rm -f "$BASE/control/active"
BACKUPS="$HOME/BigTuna-Backups"; mkdir -p "$BACKUPS"; chmod 700 "$BACKUPS"
ID="$(date +%Y%m%d-%H%M%S)-$(uuidgen)"
"$NODE" -e 'require("fs").writeFileSync(process.argv[1],require("crypto").randomBytes(32).toString("hex")+"\n",{mode:384})' "$BACKUPS/$ID.key"
WORK="$(mktemp -d "$BASE/.backup.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
"$NODE" "$KIT/helper.cjs" snapshot "$GENERATION" "$WORK/content"
"$NODE" "$KIT/migration/validate.cjs" "$WORK/content"
/usr/bin/tar -cf "$WORK/backup.tar" -C "$WORK/content" SERVER APPS PRIVATE manifest.json
"$NODE" "$KIT/migration/validate.cjs" archive "$WORK/backup.tar"
"$NODE" "$KIT/migration/crypto.cjs" encrypt "$WORK/backup.tar" "$BACKUPS/$ID.btm" < "$BACKUPS/$ID.key"
/usr/bin/shasum -a 256 "$BACKUPS/$ID.btm" > "$BACKUPS/$ID.sha256"
printf 'Encrypted backup saved under %s. Move the key to separate secure storage and copy the encrypted backup to an external disk. Services remain stopped; run Activate.command to resume final production. Restore-Backup.command validates and restores into a fresh preview generation.\n' "$BACKUPS"

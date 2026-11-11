#!/bin/sh
# Plane dashboard loop: fetch a PNG from the BigTuna server and draw it with eips.
# Started by start.sh; stopped by stop.sh (or by rebooting the Kindle).

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE=/tmp/planes-dashboard.pid
IMG=/tmp/planes.png
TMP=/tmp/planes.png.part
LOG=/tmp/planes-dashboard.log

PLANES_INTERVAL=60
PLANES_FULL_REFRESH_EVERY=10
[ -f "$DIR/planes.conf" ] && . "$DIR/planes.conf"

echo $$ > "$PIDFILE"
log() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }

cleanup() {
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
  lipc-set-prop com.lab126.pillow disableEnablePillow enable 2>/dev/null
  rm -f "$PIDFILE"
  exit 0
}
trap cleanup INT TERM

# Screen size from the framebuffer (600x800 on a Kindle 10th gen).
W=$(eips -i 2>/dev/null | sed -n 's/.*xres_virtual:[^0-9]*\([0-9]*\).*/\1/p' | head -1)
H=$(eips -i 2>/dev/null | sed -n 's/.*yres:[^0-9]*\([0-9]*\).*/\1/p' | head -1)
W=${W:-600}; H=${H:-800}

# Keep the screen on and hide the status bar while the dashboard is up.
lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null
lipc-set-prop com.lab126.pillow disableEnablePillow disable 2>/dev/null

wifi_up() {
  [ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" = "CONNECTED" ]
}

ensure_wifi() {
  wifi_up && return 0
  log "wifi down, enabling"
  lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null
  i=0
  while [ $i -lt 30 ]; do
    wifi_up && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

fetch() {
  bat=$(gasgauge-info -c 2>/dev/null | tr -dc '0-9')
  for url in "$PLANES_URL_1" "$PLANES_URL_2"; do
    [ -n "$url" ] || continue
    case "$url" in *\?*) sep='&' ;; *) sep='?' ;; esac
    full="${url}${sep}w=${W}&h=${H}${bat:+&bat=$bat}"
    rm -f "$TMP"
    if curl -fsS -m 25 -o "$TMP" "$full" 2>>"$LOG" && [ -s "$TMP" ]; then
      mv "$TMP" "$IMG"; return 0
    fi
    log "fetch failed: ${url%%\?*}"
  done
  return 1
}

n=0
log "started ${W}x${H}, every ${PLANES_INTERVAL}s"
while :; do
  if ensure_wifi && fetch; then
    if [ $((n % PLANES_FULL_REFRESH_EVERY)) -eq 0 ]; then
      eips -f -g "$IMG" >/dev/null 2>&1
    else
      eips -g "$IMG" >/dev/null 2>&1
    fi
    n=$((n + 1))
  else
    eips 1 1 "Plane dashboard: no connection, retrying..." >/dev/null 2>&1
  fi
  # Keep the log small.
  [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 50000 ] && tail -n 200 "$LOG" > "$LOG.1" && mv "$LOG.1" "$LOG"
  sleep "$PLANES_INTERVAL"
done

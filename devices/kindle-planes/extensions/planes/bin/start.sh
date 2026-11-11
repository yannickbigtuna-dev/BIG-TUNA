#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE=/tmp/planes-dashboard.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0
fi
# Give KUAL a moment to close so it doesn't paint over the first frame.
( sleep 3; exec /bin/sh "$DIR/planes.sh" ) >/dev/null 2>&1 &

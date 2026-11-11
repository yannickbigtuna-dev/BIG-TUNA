#!/bin/sh
PIDFILE=/tmp/planes-dashboard.pid
[ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
rm -f "$PIDFILE"
lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
lipc-set-prop com.lab126.pillow disableEnablePillow enable 2>/dev/null
# Repaint the normal Kindle home screen.
lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home 2>/dev/null

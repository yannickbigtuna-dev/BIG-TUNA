#!/bin/sh
# Install/remove an upstart job so the dashboard starts after every boot.
# Undo with the "Don't start on boot" menu item.
DIR="$(cd "$(dirname "$0")" && pwd)"
JOB=/etc/upstart/planes-dashboard.conf
mntroot rw >/dev/null 2>&1
if [ "$1" = "on" ]; then
  cat > "$JOB" <<JOBEOF
start on started lab126_gui
stop on stopping lab126_gui
task
script
  sleep 30
  /bin/sh $DIR/start.sh
end script
JOBEOF
  msg="Dashboard will start on boot"
else
  rm -f "$JOB"
  msg="Dashboard will not start on boot"
fi
mntroot ro >/dev/null 2>&1
eips 1 38 "$msg" >/dev/null 2>&1

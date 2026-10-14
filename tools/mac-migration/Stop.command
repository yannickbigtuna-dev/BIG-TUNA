#!/bin/bash
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
mac_only
node_ready
stop_all
rm -f "$BASE/control/active"
printf 'Mac services stopped. Windows remains a separate owner-controlled machine.\n'

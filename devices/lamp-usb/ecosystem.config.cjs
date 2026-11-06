// PM2 app for the USB lamp bridge. Start once, then `pm2 save` so the boot-time
// `pm2 resurrect` (launchd com.bigtuna.501) brings it back after any restart:
//   PM2_HOME=~/BigTuna/control/pm2 pm2 start devices/lamp-usb/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: 'bigtuna-lamp',
    script: 'bridge.py',
    cwd: __dirname,
    interpreter: '/opt/homebrew/bin/python3',
    interpreter_args: '-u',
    autorestart: true,
    restart_delay: 2000,
    max_restarts: 1000000,
    min_uptime: 5000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

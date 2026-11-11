# Kindle plane dashboard

A jailbroken Kindle (Kindle 10th gen, 2019, 600×800) shows the aircraft around home, refreshed every minute.
The server renders the picture (`lib/kindle-planes.js`, `GET /api/kindle/planes.png`); the Kindle only downloads it and draws it with `eips`.

## Install on the Kindle (after jailbreak + KUAL)

1. Plug the Kindle into the Mac mini.
2. Copy `extensions/planes` to the Kindle's `extensions/` folder.
3. Copy `planes.conf.example` to `extensions/planes/planes.conf` and set the key from `server.env` (`KINDLE_PLANES_KEY`) in `PLANES_URL_2`. Never commit `planes.conf`.
4. Eject, open **KUAL → Plane Dashboard → Start dashboard**.
5. Optional: **Start automatically on boot**.

## Stop / undo

- **KUAL → Plane Dashboard → Stop dashboard**, or restart the Kindle (hold power ~20 s). Unless autostart is on, a restart always returns to the normal Kindle.
- To remove completely: "Don't start on boot", then delete `extensions/planes`.
- To go back to stock Kindle software: download the official firmware for the Kindle (10th Generation) from Amazon's Kindle software updates page, copy the `.bin` to the Kindle root, and use **Settings → Device Options → Advanced → Update Your Kindle**.

Logs on the Kindle: `/tmp/planes-dashboard.log`.

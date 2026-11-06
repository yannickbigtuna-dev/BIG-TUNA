# Lamp over USB (+ phone presence)

The lamp relay is driven by an ESP32 that stays plugged into the Mac mini's USB.
No Wi-Fi on the ESP32: the Mac-side bridge streams the lamp state from the local
server (`127.0.0.1:3000`) and sends it over USB, so switching is local and fast.

```
App / website ─internet─▶ server (Mac mini) ─localhost SSE─▶ bridge.py ─USB─▶ ESP32 ─GPIO26─▶ relay ─NO─▶ lamp
                                     ▲                            │  ▲
                                     └── POST /api/lamp ◀─ rules ─┘  └─ phone RSSI (BLE, 1/s)
```

- `bridge.py` runs under PM2 as **`bigtuna-lamp`**. Dashboard: **http://localhost:8765** (local only).
- `firmware/lamp-usb/` is the ESP32 firmware (code in `main.cpp`).
- `config.json` holds defaults. Thresholds changed with the dashboard sliders are saved in
  `data/lamp-usb/state.json` and override the defaults.

## Wiring

```
ESP32 DevKit (USB to Mac mini)          1-channel relay module (5 V, active-low,
                                        input must accept 3.3 V logic)
┌──────────────────────┐                ┌───────────────────────┐
│ GPIO26 (D26)  ───────┼───────────────▶│ IN                    │
│ GND           ───────┼───────────────▶│ GND                   │
│ VIN (5 V from USB) ──┼───────────────▶│ VCC                   │
└──────────────────────┘                │                       │
                                        │  COM   NO   NC        │
                                        └───┬─────┬─────────────┘
                                            │     │   (NC unused)
 Wall LIVE ─────────────────────────────────┘     └──────────▶ Lamp LIVE
 Wall NEUTRAL ───────────────────────────────────────────────▶ Lamp NEUTRAL
 Wall EARTH ─────────────────────────────────────────────────▶ Lamp EARTH (if present)
```

- **Use NO, not NC.** Lamp on = relay energized. If the Mac restarts, USB loses power or the
  ESP32 resets, the relay drops and the lamp goes **off**, never on.
- One small relay module (~70 mA) runs fine from VIN on a Mac mini USB port. For a bigger
  module, power VCC from a separate 5 V supply and join its GND to the ESP32 GND.
- The mains side can carry lethal voltage. Unplug before touching it, use an enclosed relay
  rated for the lamp, keep mains and USB wiring apart, and have an electrician check it.

## Restart behaviour

- Mac reboot: launchd runs `pm2 resurrect` and the bridge comes back, reconnects to USB and
  the server, and re-sends the lamp state until the relay matches (checked every second).
- ESP32 reset or power loss: the lamp is off while it's down. At boot the ESP32 restores its
  last state from flash, and the bridge corrects it within about a second.
- Presence rules start in "learning" after any restart and never fire on startup.
- Any USB port works. The port name comes from the board's USB chip, and the bridge auto-detects it.
- Opening the serial port resets the ESP32, so each bridge restart blinks the lamp off for
  under a second if it was on.

## Presence rules (dashboard sliders)

| Rule | Default |
| --- | --- |
| Lamp OFF when the phone has been unseen for | 90 s |
| Lamp ON on arrival only if the phone was away at least | 5 min |
| Arrival needs N strong sightings within a window | 3 within 15 s |
| A strong sighting needs RSSI at least | -80 dBm |
| Quiet hours: arrival never turns the lamp on | 23:00 – 8:00 (PM2 TZ) |

Each rule fires once per change. App/website toggles work normally between events.
Presence sets the lamp with `POST /api/lamp` like the website does, so every client stays in sync.
The server stores the lamp inverted (`on:false` = physically on); the bridge converts, and the
ESP32 only ever sees the physical state.

## Common tasks

    # logs / restart
    PM2_HOME=~/BigTuna/control/pm2 pm2 logs bigtuna-lamp
    PM2_HOME=~/BigTuna/control/pm2 pm2 restart bigtuna-lamp

    # rebuild + flash firmware (stop the bridge first; it holds the port)
    pm2 stop bigtuna-lamp
    cd firmware/lamp-usb
    arduino-cli compile --fqbn esp32:esp32:esp32 --output-dir build .
    arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/cu.usbserial-0001 --input-dir build .
    pm2 start bigtuna-lamp

    # first-time setup on a new Mac
    /opt/homebrew/bin/python3 -m pip install --target .deps pyserial
    PM2_HOME=~/BigTuna/control/pm2 pm2 start ecosystem.config.cjs && pm2 save

Re-pair the phone with the dashboard's **Pair phone** button. The key survives reflashing.

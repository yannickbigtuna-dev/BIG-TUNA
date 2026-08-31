# Connect BIG TUNA Lights to Apple Home

The BIG TUNA server now presents the existing ESP-controlled relay to Apple Home as one local HomeKit light named **BIG TUNA Lights**. It does not communicate with the ESP32 directly: changing the HomeKit light writes the same desired state the website already stores, and the ESP32 continues polling the same endpoints as before.

## Pair once

1. Put this iPhone and the BIG TUNA Windows server on the same normal home LAN. Do not use a guest Wi-Fi network or a VPN while pairing.
2. Sign in to BIG TUNA as `yannick`, then open [Lights](/lights/). The HomeKit panel shows the one-time pairing code while the bridge is unpaired.
3. Open Apple's **Home** app, tap **+**, choose **Add Accessory**, then choose **More options** if the light is not suggested immediately.
4. Select **BIG TUNA Lights** and enter the code shown on the Lights page. Assign it to a room if you want.
5. Turn it on and off in Home. Allow up to the ESP32's normal polling interval for the relay to act.

After pairing, Apple Home stores the encrypted relationship. You do not need to pair again after ordinary BIG TUNA restarts or updates. With an Apple TV or HomePod configured as a Home Hub, Apple Home can also control it away from home.

## If Apple Home cannot find it

- Confirm the phone and server are on the same LAN; HomeKit discovery cannot cross the public website/Cloudflare Tunnel.
- The elevated BIG TUNA startup task configures the trusted home Wi-Fi profile and narrowly scoped Windows rules automatically: inbound TCP 51826 and UDP 5353 only on the Private profile and only from the local subnet. It never opens HomeKit to the public Internet.
- Restart the BIG TUNA server, wait about 30 seconds, then try **More options** again. If the server has moved to a different Wi-Fi network, restart it while connected to the trusted network.
- If the Home app says the accessory is already paired, do not delete `data/lights/homekit/` casually: that deletes the pairing identity and requires re-pairing. Use the same Apple Home home/account that performed the original pairing.

## Security notes

The HomeKit code is random, stored only in gitignored runtime data, and shown only to the signed-in `yannick` site account while pairing is still available. Keep the Windows server on a trusted LAN and do not share the pairing code.

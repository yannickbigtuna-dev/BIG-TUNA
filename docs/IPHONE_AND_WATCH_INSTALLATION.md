# iPhone and Apple Watch installation

## Honest status

An IPA downloaded in iPhone Safari cannot be presented as a direct install by this system. Personal-Team IPAs need an on-device/desktop signing path; App Store-style manifest installation requires distribution signing that a free Personal Team does not provide. The home-server page therefore offers an authenticated download and instructions, not a misleading “Install” action.

The default experiment is **SideStore**, because its official FAQ documents on-device refresh/update behavior and free-account limits. It is public beta software and its documentation does **not** prove embedded Apple Watch bundle, Watch app, widget, or complication support. Do not use it for a Watch release until the exact IPA has passed the checklist below. [SideStore install](https://docs.sidestore.io/docs/installation/install) and [FAQ](https://docs.sidestore.io/docs/faq).

**AltStore Classic** is the Windows alternative with official Windows/AltServer documentation, but this factory has no verified evidence that it preserves this project’s Watch bundles. **Sideloadly** is the GUI fallback; its official site supports Windows and iPhone/iPad IPA sideloading, but likewise does not document Watch-bundle preservation. [AltStore Windows installation](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows), [AltServer](https://faq.altstore.io/altstore-classic/altserver), [Sideloadly](https://sideloadly.io/).

## First-time iPhone setup

1. Install the selected installer and all prerequisites from its official documentation on the Windows PC. Do not obtain Apple components from third-party download sites.
2. Connect the iPhone by USB, unlock it, and choose **Trust** when prompted.
3. Sign in only to the installer’s own UI with the Apple Account; complete Apple’s 2FA prompt there. Never enter it into the site, repository, script, CI, or server.
4. Enable Developer Mode if the device asks: **Settings → Privacy & Security → Developer Mode**, then restart and confirm. Apple may change this flow; follow the device prompt.
5. In **Settings → General → VPN & Device Management**, trust the developer app/profile shown for the Apple Account when iOS requests it.
6. Import/install the verified IPA; compare the launcher’s displayed SHA-256 with the private release page before proceeding.
7. Launch once, approve only requested privacy prompts, and verify version/build in the app.

## Watch acceptance checklist (mandatory before claiming support)

1. Confirm the Watch is paired, unlocked, current enough for the app spec, and has Developer Mode enabled if watchOS requests it.
2. Install/update the iPhone app in place. Confirm the installer did not discard `Watch/*.app`, Watch extension, or WidgetKit bundles during signing.
3. In the iPhone Watch app, confirm the companion appears and install it; for independent apps, verify the stated independent path instead. Record the exact installer and OS versions.
4. Launch on the Watch. Test offline state, a queued WatchConnectivity transfer in each direction, and the first synchronization after reconnect.
5. Add each requested complication/Smart Stack widget; verify its timeline/state and that it survives an iPhone restart.
6. For workouts/HealthKit/location/Bluetooth/background behavior, exercise the exact consent and background scenario. Record what worked, what was denied, and battery impact.
7. Repeat on day 5–7 to determine whether the Watch app/extensions expire with the iPhone signing profile and whether the chosen refresh preserves them.

Until every item passes for a concrete release, mark Watch delivery as **unverified** in the app spec and release page.

## Daily update command / Sideloadly fallback

When a new IPA is ready, run the factory launcher supplied by the tooling package:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ios\app-factory\tools\Open-SideloadlyRelease.ps1 -Slug big-tuna-lights
```

From the Windows repository checkout, the launcher automatically uses the local
private-release directory, verifies the newest checksum, and selects the IPA in
Explorer. It also opens Sideloadly when installed. The final human action is to
drag the selected IPA into Sideloadly, choose the connected iPhone and Apple
Account, and click **Start**. Complete Apple’s trust, 2FA, and Developer Mode
prompts on the trusted PC/device. If a Watch bundle is not visibly retained or
installed, stop and record the failure—do not substitute a stripped IPA.
Add `-VerifyOnly` to print and verify the release without opening Explorer or an
installer.

## Data-preserving updates

In-place updates require the same main bundle ID, compatible signing identity/team, and compatible storage/App Group identifiers. Keep schema migrations backward-compatible; export before structural data changes. Never recommend deleting an app as a routine repair. If the installer cannot update in place, capture an app export and report the exact identity/signing conflict before any removal.

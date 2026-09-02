# BIG TUNA Lights iOS Widget

Native iPhone controller for BIG TUNA Lights. It mirrors the wall switch on the
website, with a 2x2 Home Screen widget and an iOS Control Center control. The
app signs in to `https://yannickmorgans.ca`; its App Group shares a revocable
session and the last confirmed state with its extension. Passwords are never
stored.

## Requirements

- macOS with Xcode 26 or newer (the Watch control requires the watchOS 26 SDK)
- iOS 18 or newer for the interactive widget and Control Center control
- XcodeGen
- An Apple Developer account with this App Group enabled:
  `group.ca.yannickmorgans.bigtuna.lights`

Install XcodeGen:

```sh
brew install xcodegen
```

Generate the Xcode project:

```sh
cd ios/big-tuna-lights-widget
xcodegen generate
open BigTunaLights.xcodeproj
```

In Xcode, set the development team for all four targets, confirm the App Group
is enabled for the app, widget, Watch app, and Watch widget extension, then run
the `App` scheme on an iPhone or simulator. Watch delivery still requires the
paired-device acceptance run documented in `docs/IPHONE_AND_WATCH_INSTALLATION.md`.

## Behavior

- Login exchanges the temporary website session at `POST /api/lights/native/v1/session`
  for a revocable Lights-only bearer token. Only that least-privilege token is
  shared with widgets and Watch. The native contract uses physical state:
  `PUT` sends `{ "physicalOn": Bool, "commandId": UUID }` and returns the
  authoritative state `{ physicalOn, reportedPhysicalOn, recentlyPolled,
  updatedAt, revision }`.
- Every action sends an explicit target plus a unique command ID. The client
  persists state only after that request succeeds; it never optimistically
  claims a relay change succeeded.
- Relay telemetry is confirmed only when the ESP supplies the configured
  `X-Big-Tuna-Device-Token`; legacy unauthenticated polls remain compatible but
  cannot make native or website status indicators appear trusted.
- The Home Screen widget is `.systemSmall` (the supported 2x2 footprint). Its
  interaction and the 1x1 Control Center control use `openAppWhenRun = false`.
  Widgets show a last-confirmed/offline state rather than issuing an unsafe
  blind toggle.
- The upper plate screw shows verified owner access. The lower screw shows a
  recently active relay heartbeat. Reduced Motion is respected.

Use logout in the app to clear the shared session and disable widgets/controls.
The App Group identifier remains `group.ca.yannickmorgans.bigtuna.lights`.

The companion Watch app and Watch widget/control targets are generated from the
same project but still require physical paired-Watch signing and installation
validation before they can be claimed as supported.

# BIG TUNA Lights iOS Widget

Native iPhone controller for BIG TUNA Lights. It mirrors the wall switch on the
website, with a Home Screen widget and an iOS Control Center control. The
app signs in to `https://yannickmorgans.ca`; its App Group shares a revocable
session and the last confirmed state with its extension. Passwords are never
stored.

## Requirements

- macOS with Xcode 16 or newer
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

In Xcode, set the development team for the two targets (`App` and `AppWidget`),
confirm the App Group is enabled for both, then run the `App` scheme on an
iPhone or simulator. This project intentionally contains no Apple Watch target
or companion app. The Sideloadly companion-bundle error authorized this
iPhone-only target set; physical widget and Control Center discovery still need
to be tested on the signing iPhone.

## Behavior

- Login exchanges the temporary website session at `POST /api/lights/native/v1/session`
  for a revocable Lights-only bearer token shared only with the iPhone widget.
  The native contract uses physical state:
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

The app is not physically validated yet. After Sideloadly installs it, add the
Home Screen widget and Control Center control on the iPhone and record the
result before claiming device support.

# BIG TUNA Lights iOS Widget

Native iOS controller for the existing BIG TUNA Lights API. The app signs in to
`https://yannickmorgans.ca`, stores the session in an App Group, and the widget
uses that shared session to flick the physical light on or off while still
showing the public `/api/lights` state when signed out.

## Requirements

- macOS with Xcode 15 or newer
- iOS 17 or newer for the interactive widget button
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

In Xcode, set the development team for both targets, confirm the App Group is
enabled for both the app and widget extension, then run the `BigTunaLights`
scheme on an iPhone or simulator.

## Behavior

- `GET /api/lights` is public and is used by both the app and widget to display
  current state, even before login.
- `POST /api/lights` needs the signed-in BIG TUNA session token and is still
  restricted server-side to username `yannick`.
- The existing hardware integration has reversed relay polarity, so this app
  mirrors the web Lights page and treats the physical light state as the inverse
  of the API `on` value.
- The widget button toggles the current physical state with an App Intent and
  reloads widget timelines after a successful request.

Session data is stored in App Group `UserDefaults` so the widget extension can
access it. Keep the device trusted and use logout in the app if the widget should
stop controlling the light.

# Yannick Lights for iPhone and Apple Watch

Native iPhone and companion Apple Watch controller for Yannick Lights. It
controls the same physical light as the website, with direct-toggle iPhone and
Watch widgets plus Control Center controls and current-week Yannick-versus-Emma
score widgets. The app signs in to
`https://yannickmorgans.ca`; it keeps only a revocable Lights-only session and
last confirmed state. Passwords are never stored.

## Requirements

- macOS with the current Xcode release that supports iOS 18 and watchOS 26
- iPhone with iOS 18 or newer for the interactive widget and Control Center control
- Paired Apple Watch with watchOS 26 or newer for the Watch widget/control
- Paid Apple Developer Program membership and an App Store Connect account
- The following identifiers registered under the same paid team (do not change
  released identifiers):

  - `ca.yannickmorgans.bigtuna.lights`
  - `ca.yannickmorgans.bigtuna.lights.widget`
  - `ca.yannickmorgans.bigtuna.lights.watchapp`
  - `ca.yannickmorgans.bigtuna.lights.watchapp.widget`

- This App Group enabled for all four targets:
  `group.ca.yannickmorgans.bigtuna.lights`

Open the checked-in project directly; no generator or package manager is needed:

```sh
open YannickLights.xcodeproj
```

In Xcode, select the `YannickLights` project and assign your paid development
team to all four product targets: `YannickLights`, `YannickLightsWidgets`,
`YannickLightsWatch`, and `YannickLightsWatchWidgets`.
For each target, confirm automatic signing succeeds and the App Group entitlement
is present. Run the `YannickLights` scheme on a physical paired iPhone and
Watch. The
Watch app is a companion: sign in on the iPhone first, then allow the iPhone to
send its current Lights-only token and confirmed state through WatchConnectivity.

## TestFlight publishing

This is the paid Developer Program distribution path. The earlier Sideloadly
experiment is not a TestFlight workflow and must not be used to validate or
publish this four-target build.

1. In App Store Connect, create the iOS app record using
   `ca.yannickmorgans.bigtuna.lights`. Do not create separate App Store Connect
   apps for its widget or Watch identifiers.
2. In Xcode, select the `YannickLights` archive scheme, choose **Any iOS Device (arm64)**,
   then choose **Product → Archive**. Confirm the Organizer archive contains the
   iPhone widget extension and embedded Watch app/widget extension before upload.
3. In Organizer, choose **Distribute App → App Store Connect → Upload**. Keep
   automatic signing enabled; signing credentials, certificates, profiles, 2FA
   codes, and device IDs must stay in your local Apple/Xcode workflow, never in
   this repository.
4. After Apple finishes processing, add internal TestFlight testers. Install on
   a paired iPhone and Watch, then record the observed iOS/watchOS versions,
   signing date, and the outcome of the checks below in the app-factory spec.

Before inviting broader testers, verify on physical hardware: iPhone sign-in and
logout, Home Screen widget direct toggle, iPhone Control Center direct toggle,
Watch app state/toggle, Watch widget, and Watch Control Center control. None of
the widget or Control Center actions should open the app. A failed archive,
missing embedded component, or TestFlight install must leave the previous
TestFlight build available while the configuration is corrected.

## Behavior

- Login exchanges the temporary website session at `POST /api/lights/native/v1/session`
  for a revocable Lights-only bearer token shared with the signed app-family
  extensions and paired Watch.
  The native contract uses physical state:
  `PUT` sends `{ "physicalOn": Bool, "commandId": UUID }` and returns the
  authoritative state `{ physicalOn, reportedPhysicalOn, recentlyPolled,
  updatedAt, revision }`.
- Every action sends an explicit target plus a unique command ID. Foreground UI
  may animate optimistically while a request is pending, but only a successful
  server response enters shared storage; a follow-up read reconciles the display.
- Relay telemetry is confirmed only when the ESP supplies the configured
  `X-Big-Tuna-Device-Token`; legacy unauthenticated polls remain compatible but
  cannot make native or website status indicators appear trusted.
- The light Home Screen widget is `.systemSmall` (the supported 2x2 footprint),
  and score widgets support `.systemSmall`, `.systemMedium`, and `.systemLarge`.
  Widget interaction and the 1x1 iPhone Control Center control run without
  opening the app.
  Widgets show a last-confirmed/offline state rather than issuing an unsafe
  blind toggle.
- The companion Watch receives the revocable token and confirmed state through
  WatchConnectivity, then uses direct HTTPS when it has network access. Its
  watchOS 26 control toggles from Control Center or Smart Stack without opening
  the app. Watch-face complications deep-link to the relevant one-tap Watch
  screen because that surface is not a silent network-mutation trigger.
- The Watch app's first page is the large light control and its second page is
  the current weekly score. Reduced Motion, VoiceOver, and explicit text states
  are supported throughout.

Use logout in the app to revoke/clear the shared session and disable iPhone and
Watch widgets/controls. The App Group identifier remains
`group.ca.yannickmorgans.bigtuna.lights`.

The paid-team/TestFlight configuration has not yet been physically validated.
Do not claim Watch, widget, or Control Center support until the physical checks
above have been recorded.

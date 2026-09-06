# Yannick Lights 1.3.0 (6)

Release preparation date: 2026-09-05

## Changed

- Renames the native product presentation to Yannick Lights while preserving
  every released bundle identifier and the existing App Group.
- Adds the live current-week Yannick-versus-Emma score to the iPhone app, iPhone
  widgets, Watch app, Smart Stack, and optional Watch complications.
- Adds direct Watch HTTPS reconciliation, a Watch-native watchOS 26 control,
  reusable App Intents/Shortcuts, explicit unavailable states, and cached score
  fallback without hardcoded results.
- Adds a directly openable five-target `YannickLights.xcodeproj`, production icon
  master, Windows structural audit, and a one-file Mac/TestFlight handoff.

## Included components

- iPhone app: yes
- Interactive Home Screen light widget: yes (`systemSmall`)
- Score widgets: yes (`systemSmall`, `systemMedium`, `systemLarge`)
- iOS Control Center control: yes, through the iPhone widget extension
- Apple Watch companion app: yes
- Watch score/light widgets and complications: yes
- watchOS 26 Control Center/Smart Stack control: yes
- Unit-test target: yes

## Compatibility

- Minimum iOS: 18.0
- Minimum watchOS: 26.0
- Light API: `/api/lights/native/v1`
- Score API: `/api/strava-challenge/public`

## Signing and TestFlight

This source release is prepared for the paid Apple Developer Program. The owner
must select the paid team, archive, validate, and upload from Xcode on a trusted
Mac. No Apple credential, certificate, provisioning profile, device identifier,
or signing key is stored in the repository or transfer ZIP.

## Data and migration

- App Group schema version 1 and all existing light/session keys are preserved.
- The compact weekly-score cache uses an additive key and needs no migration.
- WatchConnectivity transfers only the revocable Lights-only session and latest
  confirmed state; both apps otherwise use the real HTTPS services directly.

## Validation status

- Windows spec, plist/entitlement, PBX graph, ZIP inventory, secret, live
  read-only contract, focused, and full repository checks: passed on 2026-09-05
- Xcode compilation/archive inspection: requires the owner's Mac
- Paid signing and TestFlight upload: manual, not yet performed
- iPhone/widget/control physical tests: not tested
- Watch app/widget/complication/control physical tests: not tested

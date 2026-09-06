# BIG TUNA Lights 1.2.0 (5)

Release preparation date: 2026-09-04

## Changed

- Restores the companion Apple Watch app using its original recorded bundle ID.
- Restores the Watch widget, complication, and watchOS control in the existing
  Watch WidgetKit extension.
- Moves the maintained release workflow from seven-day Personal Team
  sideloading to paid Apple Developer Program signing and TestFlight.
- Keeps the iPhone app, Home Screen widget, and iOS Control Center control.

## Included components

- iPhone app: yes
- Home Screen widget: yes
- iOS Control Center control: yes, through the iPhone widget extension
- Apple Watch companion app: yes
- Watch widget and complications: yes
- watchOS control: yes, through the Watch widget extension

## Compatibility

- Minimum iOS: 18.0
- Minimum watchOS: 26.0
- Server API: `/api/lights/native/v1`

## Signing and TestFlight

This source release is prepared for the paid Apple Developer Program. The owner
must generate the Xcode project, select the paid team, archive it, validate it,
and upload it to App Store Connect from the trusted Mac. No Apple credentials,
certificate, provisioning profile, or signing key is stored in the repository.

## Data and migration

- Data compatibility: App Group keys and schema version 1 are preserved; no
  migration is required.
- The original iPhone, widget, Watch app, Watch widget, and App Group identities
  are preserved.
- WatchConnectivity transfers the revocable Lights-only session and latest
  confirmed state from the iPhone to the companion Watch app.

## Validation status

- Spec and local tooling: pending final validation
- macOS unsigned compilation/archive inspection: pending
- Paid signing and TestFlight upload: manual, not yet performed
- iPhone, widget, and iOS Control Center physical tests: not tested
- Watch app, complication, and watchOS control physical tests: not tested

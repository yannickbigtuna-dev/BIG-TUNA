# Yannick Lights — Windows source guide

This folder is the no-dependency, unified Xcode handoff source for **Yannick
Lights**. Work is authored on Windows, but compilation, signing, archive
validation, TestFlight upload, and physical iPhone/Apple Watch checks require
a Mac with Xcode and the owner's paid Apple Developer account.

## Product map

`YannickLights.xcodeproj` contains four products in one archive:

- `YannickLights`: native iPhone SwiftUI app, sign-in/session flow, light
  controller, and secondary weekly score strip.
- `YannickLightsWidgets`: iPhone Home Screen light/score widgets and the
  Control Center light control.
- `YannickLightsWatch`: companion watchOS app with its first screen devoted to
  one-tap lights and a second, glanceable Yannick-versus-Emma score screen.
- `YannickLightsWatchWidgets`: watchOS Smart Stack score/light widgets,
  complications, and the supported watchOS control surface.

Presentation naming is Yannick Lights. The identifiers below are deliberately
the existing released identity; do not rename them merely to match display
copy:

| Product | Bundle identifier |
| --- | --- |
| iPhone app | `ca.yannickmorgans.bigtuna.lights` |
| iPhone widget/control extension | `ca.yannickmorgans.bigtuna.lights.widget` |
| Watch companion | `ca.yannickmorgans.bigtuna.lights.watchapp` |
| Watch widget/control extension | `ca.yannickmorgans.bigtuna.lights.watchapp.widget` |

All four use `group.ca.yannickmorgans.bigtuna.lights`. It holds only shared
last-confirmed state/score and the scoped Lights credential according to the
implementation. It must remain identical across entitlements and signing
capabilities.

Deployment targets are iOS 18 and watchOS 26 because the project intentionally
uses modern interactive WidgetKit/App Intents/ControlWidget APIs rather than
legacy compatibility architecture. The source has no CocoaPods, Swift Package
Manager packages, npm, Homebrew, or XcodeGen requirement to open the included
project on the Mac.

## Shared contracts and key source areas

- `Shared/`: models, URLSession clients, cache, App Intents, and serialized
  light-state coordination. Reuse this contract; do not fork a second light
  client for a widget.
- `BigTunaLights/`: iPhone app views and application state.
- `BigTunaLightsWidget/`: iPhone widgets and Control Center control.
- `BigTunaLightsWatch/`: Watch app, haptics, direct HTTPS behavior, and optional
  WatchConnectivity synchronization.
- `BigTunaLightsWatchWidget/`: Smart Stack widgets, complications, and watch
  control.
- `YannickLightsTests/`: focused decoding, error, cache, and request tests.
- `project.yml`: source declaration of the target graph; the checked-in
  `YannickLights.xcodeproj` is the directly openable Mac deliverable.
- `API-DISCOVERY.md`: authoritative app-facing HTTP contract and security
  boundary.
- `MAC-INSTRUCTIONS.md`: owner-facing install, signing, TestFlight, widgets,
  Watch, and update guide.

The native light path is HTTPS app → `yannickmorgans.ca` native API → existing
server/device workflow. It uses physical state (`physicalOn`) and explicit,
idempotent target commands. Legacy website relay inversion belongs only on the
server adapter. The public score path is the cached
`/api/strava-challenge/public` dashboard; scores must not be hardcoded.

## State, widgets, and reliability rules

- Read the authenticated native state before presenting a newly confirmed
  state. A visual optimistic transition is permissible only while it is clearly
  loading. Persist only authoritative server responses: normally the reconciled
  GET, or the successful explicit PUT response when its follow-up GET is
  temporarily unavailable.
- Every write must be an explicit `physicalOn` target plus a fresh command ID.
  Keep mutation serialization; rapid taps must not become racing blind toggles.
- On timeout, invalid JSON, HTTP error, Watch offline state, or verification
  failure, retain the last confirmed cache, end loading, and report failure.
- Widgets and controls use the same intent/service/cache, reload their
  timelines after confirmed changes, and must not silently show a made-up
  state. Score widgets keep the most recent valid score when their public
  refresh fails.
- Watch requests should use direct HTTPS when connectivity permits. Do not make
  WatchConnectivity a prerequisite; use it only for scoped token/state sync.
- App Intents include on, off, toggle, and status. Widget/control invocation
  should keep `openAppWhenRun = false` where the platform allows it. A standard
  complication tap remains an app launch/deep link unless the platform's exact
  surface exposes an approved interactive control.

## Future-update workflow

1. On Windows, inspect `CODEX_CONTEXT.md`, `docs/AI-WORKFLOW.md`, the Apple
   factory/spec documentation, this file, and affected source before changing
   anything.
2. Preserve all existing target IDs, App Group, entitlement membership, server
   API semantics, Watch embedding, and App Intent identifiers unless an
   explicit migration/release decision has been approved.
3. Update Swift/project files together, then run the repository's structural
   project audit, plist/entitlement checks, focused tests, secret scan, and
   inspect the generated/static project graph. Windows cannot establish an
   Xcode build or device result.
4. Package the whole folder as `C:\SERVER\YannickLights-Xcode.zip` using the
   maintained packaging script. The ZIP must contain one directly openable
   `YannickLights.xcodeproj`, all four products, documentation, assets, and no
   credentials, build products, `DerivedData`, tokens, provisioning profiles,
   or device IDs.
5. On the Mac, preserve signing, increase `CURRENT_PROJECT_VERSION` for every
   upload, archive the primary iPhone scheme, and let TestFlight deliver the
   embedded Watch companion. See `MAC-INSTRUCTIONS.md`.

## Guardrails for future coding agents

- Never replace this project with React Native, a web view, a direct ESP/LAN
  client, fake API data, or a second Xcode project/ZIP.
- Never put a website password, website session, native bearer token, Strava
  secret/token, ESP token, certificate, profile, private key, 2FA value, or
  device ID in source, assets, documentation, logs, or a ZIP.
- Never remove a Watch target, widget extension, App Group, capability, or
  embed relationship to clear a signing/build error. Diagnose the configuration
  and preserve identity/data instead.
- Keep the system limitations honest. Do not claim an untested Mac archive,
  physical Watch behavior, TestFlight outcome, or unavailable Apple surface is
  working because a Windows static audit passed.
- If changing persisted cache format, retain compatible decoding and explicitly
  migrate/clear safely. If changing a released identity, require an explicit
  migration plan before edits.

# Apple App Factory

## Purpose

Apple App Factory turns a plain-English request into a maintained native Swift/SwiftUI project under `ios/app-factory/`. It is deliberately split into source/build, signing/install, and private distribution so a cloud build never receives an Apple Account password or a reusable private signing key.

This is a Personal Team development workflow, not an App Store, TestFlight, ad-hoc, or enterprise distribution system. A successful unsigned GitHub macOS build proves target compilation only. A physical-device acceptance run is required before claiming that an iPhone widget, Watch app, complication, HealthKit, background mode, or installer preserves the requested feature.

## Non-negotiable rules for future Codex sessions

Before changing an Apple app, read this document, `docs/APPLE_FREE_SIGNING.md`, `docs/APPLE_CAPABILITY_MATRIX.md`, the app's `ios/app-factory/specs/<slug>.yml`, its latest release manifest, and its migration notes. Keep `app_slug`, every released bundle identifier, App Group identifier, storage format, and server API contract stable. Do not remove a target, entitlement, or extension merely to make a build/signing error disappear.

1. Translate the request into the existing app spec. If a requested capability is `blocked`, `unknown`, or needs paid membership in the matrix, stop before enabling it and explain the smallest viable fallback.
2. Generate the Xcode project deterministically from the spec; use native Swift and SwiftUI. Enable only the requested targets.
3. Update applicable tests, privacy usage strings, data migration/export logic, version, build number, and release notes. Version increments are monotonic; build numbers never decrease.
4. Run local configuration validation, then the macOS CI compilation. CI must inspect the generated IPA/archive for every enabled extension and fail if any expected bundle is absent.
5. Only a fully successful build may create immutable `releases/<version>/` content. It must calculate SHA-256 before and after upload; a failed build/upload may never replace `latest`.
6. Publish only through the owner-authenticated release service. Downloading an IPA in Safari is not installation under this workflow. Never make a button claim otherwise.
7. Prepare the local installer launcher and give the owner the minimal Apple-required confirmation steps. Record actual iPhone/Watch results in the spec and release notes.

## Layout and contracts

```text
ios/app-factory/
  specs/<slug>.yml                 # authoritative app identity/capability contract
  template/                        # native source and deterministic XcodeGen input
  tools/                           # validate, generate, version, inspect, checksum
  release-notes/TEMPLATE.md
data/apple-app-factory/releases/   # ignored, private server release root
  <slug>/releases/<version>/
  <slug>/latest.*                  # updated only after verification
```

The expected per-release files are `<AppName>.ipa`, `manifest.json`, `release-notes.txt`, `sha256.txt`, and an icon. The server implementation may expose them through authenticated routes rather than public `/apps/`; that is intentional. `index.json`/AltStore-source metadata are optional derived data, never the authority for a release.

## Target design

The template supports an iPhone application plus independently selectable WidgetKit, Lock Screen widget, Live Activity, iPhone controls, companion Watch app, independent Watch app, Watch widget/complication, watchOS controls, and WatchConnectivity components. Controls reuse their platform's existing widget extension rather than consuming another bundle ID. iPhone controls require iOS 18 or newer; Watch controls require watchOS 26 or newer. A target toggle is a build contract: the spec lists its bundle ID and the archive inspector asserts it exists.

An app with maintained product-specific XcodeGen sources may set the validated
`factory.sourceProject` field to a repository-relative directory below `ios/`.
Generation copies that tree only into a fresh build directory, verifies the
requested bundle IDs in its `project.yml`, and emits target evidence for archive
inspection. It never overwrites the product source.

Use App Groups only where the selected signing profile permits them; otherwise use a local app-owned store and WatchConnectivity/server synchronization. Prefer offline-first local storage, a versioned Codable schema, migration functions, an explicit export/backup path, and an idempotent server sync queue. Watch transfers must use `WCSession` application context for current state and queued user-info/file transfers for durable payloads, with no polling loop that wastes battery.

For health/workout/location/Bluetooth/notifications, add only the necessary capability, entitlement, `Info.plist` privacy text, consent UI, and device acceptance tests. “Builds” is not “authorized” and “authorized” is not “works in background.”

## Build and release lifecycle

1. Create `specs/<slug>.yml` from the template; choose a stable reverse-DNS namespace before the first release.
2. The current build tools validate identifiers, target dependency graph, capability selection, and version/build. Release-note quality/completeness and secret review remain required human/reviewer checks; the tools do not currently validate either.
3. GitHub Actions on a macOS runner generates the project, compiles every generated target, archives unsigned, packages an IPA without re-signing, inspects nested app/Watch/extension bundles, emits checksums and build evidence, and uploads CI artifacts. It does not currently run a Swift test suite; add test targets and a test step before describing tests as automated.
4. A server upload occurs only when owner-supplied, directory-scoped deployment secrets are configured. Otherwise CI artifacts remain in GitHub and `latest` is unchanged.
5. A Windows launcher finds the newest verified IPA and opens it in the selected installer. It never automates credentials, 2FA, trust, Developer Mode, or a GUI control that has no supported command interface.

The BIG TUNA Lights 1.1.0 (2) product completed the cloud macOS build, unsigned
archive packaging, and component inspection in run 33631213210 on 2026-09-02.
Its checksum-verified artifact was promoted into local private release storage.
Free signing, iPhone installation, and Watch delivery remain explicit physical
acceptance gates.

## Plain-English prompts

Create: “Create a private native iPhone app named **<name>**. It should **<plain-English behavior>**. Include **<widgets/watch/capabilities>**; keep it offline-first and publish only to my private Apple App Factory page.”

Update: “Update **<app slug or name>**: **<plain-English change>**. Preserve its identity, data, widgets, Watch components, and existing capabilities. Build, publish if the configured private pipeline succeeds, and prepare the verified local installer.”

## Sources and review cadence

Apple changes signing/capability policy. Before each new capability or installer choice, recheck Apple’s [Personal Team overview](https://developer.apple.com/help/account/basics/about-your-developer-account/), [iOS capability matrix](https://developer.apple.com/help/account/reference/supported-capabilities-ios), and [watchOS capability matrix](https://developer.apple.com/help/account/reference/supported-capabilities-watchos). Installer documentation is secondary to successful physical validation; see `docs/IPHONE_AND_WATCH_INSTALLATION.md`.

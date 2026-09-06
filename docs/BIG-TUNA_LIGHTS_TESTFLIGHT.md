# BIG TUNA Lights: Xcode, TestFlight, and Apple Watch guide

This guide prepares the maintained BIG TUNA Lights source for a paid Apple
Developer Program account and TestFlight. It does not contain Apple credentials
or signing files, and it does **not** claim a successful upload or physical
iPhone, widget, Control Center, or Watch validation. Keep that evidence with
the release record after you perform it.

The transfer ZIP is source only. Build it from this repository with:

```powershell
node scripts/apple-app-factory/package-big-tuna-lights-xcode.mjs --output C:\Transfer\BIG-TUNA-Lights-Xcode.zip
```

Copy the ZIP to the Mac, unzip it, and run `Bootstrap.command`. It requires
Xcode and XcodeGen (`brew install xcodegen`), generates the Xcode project from
`project.yml`, and opens it. Do not put an Apple ID password, app-specific
password, 2FA code, certificate, provisioning profile, or private key in this
repository or transfer package.

## 1. Prepare the Apple account and identifiers

1. Sign in at Apple Developer, accept the current agreements, and confirm that
   the paid team appears in Xcode and App Store Connect. If either portal shows
   a new agreement, accept it before attempting an upload.
2. In Certificates, Identifiers & Profiles, register the identifiers required
   by the source project. Keep every released identifier stable. The current
   factory spec is the source of truth for the exact bundle identifiers, App
   Group, targets, version, and build: `ios/app-factory/specs/big-tuna-lights.yml`.
3. Enable the App Group listed in that spec on every target that shares the
   Lights-only session/state. Do not substitute a new group ID for an existing
   release: that can make widgets lose access to their shared state.
4. Let Xcode manage signing after the identifiers and group are available. In
   each target’s **Signing & Capabilities**, select the paid team and verify
   the displayed bundle ID and App Group match the spec. Do not “fix” a signing
   error by deleting a target, changing a bundle ID, or removing a capability.

Inside the transfer ZIP, the same contract is copied to `APP-SPEC.yml` for
reference; the repository remains authoritative for future version changes.

Apple references: [register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id)
and [enable App Groups](https://developer.apple.com/help/account/identifiers/enable-app-capabilities).

The Home Screen widget and iPhone Control Center control are delivered by the
existing widget extension; they are not standalone apps. Their actions are
designed to request an explicit state change without opening the app, but that
must be physically tested on a signed device.

## 2. Build and archive on the Mac

1. Open the generated `BigTunaLights.xcodeproj` in Xcode. Choose the iPhone
   app scheme and a real iPhone first. Confirm the app launches and can sign in
   without storing a website password in the app or App Group.
2. Add the Home Screen widget and the Control Center control manually on the
   phone. Test both off-to-on and on-to-off actions, including an offline/error
   response. They must toggle only after a successful server response and must
   not launch the app.
3. Select **Any iOS Device (arm64)**, then choose **Product → Archive**. In the
   Organizer, select the new archive and use **Validate App** before upload.
   Resolve errors by correcting the declared target/capability configuration,
   then archive again.
4. In Organizer choose **Distribute App → App Store Connect → Upload**. Keep
   the standard automatic distribution/signing choices unless your organization
   has an approved alternative. Wait for Xcode to report that upload completed.

Do not use the private home-server IPA workflow for TestFlight. TestFlight is
Apple-hosted distribution; an Organizer upload uses the paid developer account.
Apple's current Xcode flow is documented in
[Distributing your app for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## 3. Create the App Store Connect record and TestFlight build

Before the first upload, App Store Connect may require an app record:

1. Go to **Apps → + → New App**. Choose iOS, enter the product name, primary
   language, the exact primary bundle ID, and a unique SKU. Keep the same app
   record for later builds.
2. After upload, open **Apps → BIG TUNA Lights → TestFlight**. Apple processes
   the build before it can be tested; processing can take time. Complete any
   requested export-compliance, encryption, content, or compliance questions
   truthfully for this build.
3. For internal testing, add users under **Users and Access** with an App Store
   Connect role, create/select an internal TestFlight group, then add the
   processed build to that group. Internal testers install Apple’s TestFlight
   app, accept the email invite, and install the build there.
4. For external testing, create an external group, add the processed build,
   provide the required beta-app description, feedback email, and test
   instructions, then submit it for **Beta App Review**. Do not invite external
   testers until Apple approves that build for external testing. Add testers by
   email or public link only after approval and only for people you intend to
   give access to.
5. Each later upload must use a higher build number for the same version. Update
   the factory spec/project version deliberately before archiving; do not reuse
   a build number Apple has already received.

Apple references: [create the app record](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/),
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview),
and [export compliance for beta builds](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/).

TestFlight builds expire after Apple’s TestFlight availability period (normally
90 days); the TestFlight page is authoritative for the shown expiration date.
This replaces the seven-day limit of Personal Team device testing, but it does
not validate this project or its extensions automatically.

## 4. Apple Watch delivery and testing

If the Xcode project generated from the current source includes a Watch app,
select the paired Watch as the run destination and let Xcode install the
companion during development. For TestFlight, install the iPhone build first;
then in the iPhone **Watch** app, look for BIG TUNA Lights under available apps
and install it. Apple may present the companion automatically depending on the
target configuration and OS version.

Before telling anyone the Watch app works, record all of these on real hardware:

- iPhone model/iOS, Watch model/watchOS, Xcode version, and TestFlight build.
- That the Watch app appears, installs, launches, and retains the expected
  bundle hierarchy after TestFlight installation.
- The Watch light state, offline behavior, and a state change in each direction
  if the project uses WatchConnectivity.
- Any Watch widget, complication, Smart Stack item, or Control Center control
  requested by the build, including whether its action stays out of the app.

If the Watch target is absent from the current project, do not create a Watch
claim in App Store Connect. Add the target through the app spec/project first,
then repeat signing, archive validation, TestFlight upload, and this device
checklist. A successful iPhone upload alone is not evidence of Watch support.

## Release evidence and safe rollback

For every TestFlight build, retain a small private record: version/build, Xcode
and OS versions, archive validation result, upload time, TestFlight processing
result, tester group, physical widget/control/Watch observations, and exact
non-sensitive errors. Never record credentials, certificates, device IDs, or
private release URLs in source control.

If a build fails validation, processing, or device testing, stop distribution
for that build. Upload a corrected build number; do not delete a working app or
change released bundle/App Group identities merely to clear the error.

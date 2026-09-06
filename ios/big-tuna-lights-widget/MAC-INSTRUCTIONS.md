YOU NOW HAVE THE PROJECT ON YOUR MAC.

This ZIP is complete source for one unified iPhone, widget/control, Apple Watch,
and Watch widget/complication project. You do not need Homebrew, CocoaPods,
npm, or XcodeGen to open it.

## First open

1. Copy `YannickLights-Xcode.zip` to the Mac and double-click it to unzip.
2. Open the resulting `YannickLights-Xcode` folder.
3. Double-click **`YannickLights.xcodeproj`**. Do not open `project.yml` and do
   not run a generator.
4. Let Xcode finish indexing before changing settings. If it asks to enable a
   system component, follow Xcode's prompt.

## Add your Apple Developer account

1. In Xcode, choose **Xcode → Settings → Accounts**.
2. Click **+**, choose **Apple ID**, then sign in with the Apple ID enrolled in
   your paid Apple Developer Program.
3. Complete two-factor authentication and any Apple agreements in Xcode or the
   Apple Developer website. Confirm your paid Team appears in the account list.

Never add your Apple ID password, app-specific password, 2FA code,
certificates, provisioning profiles, private keys, or device IDs to this
project/ZIP.

## Signing every target

In the Project navigator, select `YannickLights`, select each target below, and
open **Signing & Capabilities**. For every one, turn on **Automatically manage
signing** and select the same paid Team. Do not change a bundle identifier to
solve a signing error: these are retained identifiers for the existing app
family.

| Target/product | Bundle identifier |
| --- | --- |
| YannickLights (iPhone app) | `ca.yannickmorgans.bigtuna.lights` |
| YannickLightsWidgets (iPhone WidgetKit/control extension) | `ca.yannickmorgans.bigtuna.lights.widget` |
| YannickLightsWatch (Watch companion) | `ca.yannickmorgans.bigtuna.lights.watchapp` |
| YannickLightsWatchWidgets (Watch WidgetKit/control extension) | `ca.yannickmorgans.bigtuna.lights.watchapp.widget` |

For all four targets, verify the **App Groups** capability contains exactly:

`group.ca.yannickmorgans.bigtuna.lights`

If Xcode says the identifier or App Group is unavailable, sign into the correct
paid Team and register/enable that capability in Apple Developer Certificates,
Identifiers & Profiles for the same identifiers. Then return to Xcode and let
automatic signing refresh profiles. Do not delete the Watch target, widget
extension, capability, or embed relationship. The extensions are embedded in
the iPhone app/Watch companion; they are not separate App Store Connect apps.

`YannickLightsTests` is the unit-test bundle. It depends on the signed iPhone
app during testing, but it does not need its own App Group or separate App Store
Connect record.

## Build and test on your iPhone

1. Connect and unlock the iPhone with a data-capable cable. Tap **Trust** on the
   iPhone if asked.
2. If prompted, enable **Developer Mode**: iPhone **Settings → Privacy &
   Security → Developer Mode**, restart when instructed, then confirm it.
3. At the top of Xcode, select the `YannickLights` scheme and your iPhone as
   Run destination.
4. Click the Run triangle or press **⌘R**. Xcode installs the app.
5. In Yannick Lights, sign in, wait for the real light state, then test OFF →
   ON and ON → OFF. Test an offline/server-error case as well; it should retain
   last-confirmed state and show failure rather than pretending success.

## Build and test the Apple Watch companion

Keep the paired iPhone connected and unlocked. In Xcode's scheme/destination
menu, select the paired Apple Watch destination shown underneath that iPhone,
then Run the Watch scheme (or run the iPhone app; Xcode should build/embed the
companion as part of the app graph). The Watch must be paired, unlocked, and on
a compatible watchOS version.

After installation, look for **Yannick Lights** in the Watch app grid/list and
open it. Its first screen is the one-tap light control; swipe/page to the score
screen. If the Watch companion did not install automatically, open the
**Watch** app on the iPhone, scroll to **Available Apps**, find Yannick Lights,
and tap **Install**. Also verify the iPhone app has signed in first so its
revocable Lights-only session can be synchronized; the Watch can use direct
HTTPS when it has network connectivity.

## Add iPhone Home Screen widgets

1. Touch and hold an empty part of the Home Screen until icons jiggle.
2. Tap **Edit**, then **Add Widget**.
3. Search for **Yannick Lights**.
4. Add the Light widget (the smallest supported square WidgetKit family) and
   select the weekly Score widget in small, medium, or large as desired.
5. Exit editing. Tap the light action to test that it changes the real state
   without opening the app; the score is read-only and updates by its timeline.

## Add the iPhone Control Center control

1. Swipe down from the top-right corner to open Control Center.
2. Touch and hold its background, then tap **Add a Control**.
3. Search for **Yannick Lights** and add its light control.
4. Use it to test both directions. It uses the real backend and is designed not
   to open the app. If no state is confirmed yet, open/sign in to the iPhone
   app first and retry after it completes a refresh.

## Add Apple Watch Smart Stack widgets

From the Watch face, rotate the Digital Crown upward to open the Smart Stack.
Touch and hold the Smart Stack until it enters edit mode, tap **+**, find
**Yannick Lights**, and add the Yannick-versus-Emma score widget. Choose the
rectangular/accessory presentation when offered; it shows current weekly scores
with red Yannick and blue Emma accents. Tap **Done** when the Watch offers it.

Add the Light Smart Stack widget too if it is offered. On the supported current
watchOS control/widget surface it invokes the shared App Intent directly; if a
specific Smart Stack family offers only a widget tap, that tap opens directly
to the Watch light-control screen instead. Test this on your actual Watch,
because Apple can vary available placements by OS version and face.

## Add Watch-face complications

On the Watch: touch and hold the face → **Edit** → swipe to **Complications** →
tap a slot → choose **Yannick Lights** → select the light or score family that
fits → press the Digital Crown to save.

Or on iPhone: open the **Watch** app → **Face Gallery** (or **My Faces**) →
choose the face → tap a complication slot → choose **Yannick Lights** → add/set
the face.

The score complication is a glanceable `Y 4–3 E`-style summary when a family
has enough room. A standard watch-face complication is a launch/deep-link
surface: Apple does not permit a complication tap to silently perform an
arbitrary network mutation as a direct toggle. Tapping the light complication
therefore opens Yannick Lights directly to its main one-tap light screen. This
is intentional and supported.

## Apple Watch Control Center

On the project's watchOS 26 target, the provided native ControlWidget control
is the supported third-party control path. On the Watch, open Control Center
(normally press the side button), scroll to the end, tap **Edit**, choose **+**
or **Add Controls**, search **Yannick Lights**, and add the light control.
Its availability and exact edit wording are controlled by the installed
watchOS; if Apple does not show it, update the Watch to the deployment target,
confirm the signed Watch widget extension was installed, and use the fastest
supported alternatives: the Watch app's first screen, the Smart Stack light
widget/control, or the light complication which opens that screen. Do not
expect a complication itself to toggle directly.

## TestFlight: first upload

Before the first upload, create one App Store Connect record for the iPhone
app—not separate records for widgets or Watch extensions:

1. Visit App Store Connect → **Apps** → **+** → **New App**.
2. Choose **iOS**, enter **Yannick Lights**, choose primary language, select
   `ca.yannickmorgans.bigtuna.lights`, and enter a unique SKU. Save.
3. Back in Xcode, select the primary `YannickLights` scheme and **Any iOS
   Device (arm64)** (or the archive destination Xcode presents).
4. Check version and build in the target's General tab. `MARKETING_VERSION` is
   the customer version (the included project is 1.3.0); `CURRENT_PROJECT_VERSION`
   is the upload build number (the included project is 6). Every upload to the same App Store
   Connect version needs a new, higher build number.
5. Choose **Product → Archive**. When it finishes, Organizer opens. Inspect the
   archive/validation warnings and confirm it includes the iPhone widget and
   embedded Watch app/widget extension.
6. In Organizer choose **Distribute App → App Store Connect → Upload**. Use
   automatic signing unless your Team requires a managed alternative; complete
   Apple's validation/upload flow truthfully.

Apple processes the build before it appears under the app's **TestFlight** tab.
Complete any App Store Connect questions for that exact build, including export
compliance, content, and contact details. This project uses standard HTTPS
networking through URLSession only and declares
`ITSAppUsesNonExemptEncryption` as `false`; it does not implement custom
cryptography. That setting is not permission to give a false answer—read
Apple's current form and answer based on the final archived app and your legal
context. Ordinary TLS/HTTPS transport generally falls within Apple's exempt
uses, but Apple/App Store Connect is authoritative for the question presented.

For internal testing, add people with App Store Connect access under **Users
and Access**, create/select an internal TestFlight group, and add the processed
build. For external testing, create an external group, add accurate beta
description/contact/test notes, then submit the build for **Beta App Review**;
only invite external testers after Apple approves it.

On an iPhone, install Apple's **TestFlight** app from the App Store, sign into
the invited Apple ID, accept the invitation/build, and install Yannick Lights.
Later builds update through TestFlight. TestFlight shows the actual build
expiration date (commonly 90 days); do not confuse it with seven-day Personal
Team testing.

The Watch companion is bundled inside the TestFlight iPhone app. It may install
automatically on a paired compatible Watch. If it does not, open the iPhone
Watch app and install Yannick Lights under Available Apps. If it still is not
listed, verify the archived/uploaded build contains the Watch products, all
four targets use the paid Team/App Group, the Watch OS meets the target, and
the iPhone/Watch pairing is healthy; archive and upload a corrected higher
build rather than altering released identifiers.

## Later updates from Windows

1. Codex updates the source on Windows and creates a new
   `YannickLights-Xcode.zip`.
2. Copy it to the Mac, unzip it, and double-click `YannickLights.xcodeproj`.
3. Keep the same Team/signing/App Group; reselect them only if Xcode asks.
4. Increase `CURRENT_PROJECT_VERSION` once, consistently for the archive.
   Keeping the marketing version until you intentionally make a user-visible
   release is the simplest reliable pattern.
5. Archive the primary iPhone scheme, upload it, wait for TestFlight processing,
   and update the iPhone from TestFlight. The embedded Watch companion updates
   through the paired iPhone/Watch delivery flow.

Record the Xcode/iOS/watchOS versions, archive/upload result, physical widget/
control/Watch checks, and any non-sensitive failure for each release. Do not
claim a surface works until it has been verified on your signed devices.

# Apple capability matrix

Status is intentionally conservative. “Framework usable” means source can be written and an unsigned build can compile; it is not a promise that Personal Team provisioning, an IPA installer, or a physical device will permit it. Apple’s current [iOS](https://developer.apple.com/help/account/reference/supported-capabilities-ios) and [watchOS](https://developer.apple.com/help/account/reference/supported-capabilities-watchos) tables are the policy source; recheck before enabling a row.

| Capability | iPhone / Watch | Free provisioning | Entitlement / identifier | free-ID impact | physical setup & limits | fallback |
|---|---|---|---|---|---|---|
| Main native app | both | Yes, seven-day device testing | bundle ID; app ID budget | main app ID | device trust/Developer Mode as prompted; 3 apps/device | rebuild/reinstall |
| WidgetKit Home / Lock Screen | iPhone | Conditional—extension signing must be tested | widget extension bundle; WidgetKit | extension ID: measure on device | physical widget/timeline test | in-app dashboard |
| Live Activities | iPhone | Conditional | ActivityKit, optional push token capability | no extra ID unless separate extension/service is enabled | device/live-activity setting | local notification/in-app status |
| Companion Watch app | Watch + iPhone | **Unverified installer support** | nested Watch app/extension IDs | Watch IDs: measure on device | paired Watch; physical install test | iPhone-only app |
| Independent Watch app | Watch | **Unverified installer support** | Watch app/extension IDs | Watch IDs: measure on device | paired Watch; independent install test | companion design |
| Watch widgets / complications | Watch | **Unverified installer support** | WidgetKit extension | extension ID: measure on device | add/configure on Watch | Watch app screen |
| WatchConnectivity | both | Conditional | no special service entitlement normally | none known; record observed result | paired-device, offline queue test | HTTPS sync/manual export |
| App Groups / shared settings | both | Apple table must allow profile; do not assume | `com.apple.security.application-groups` + group ID | group ID/associated app IDs: record | target/profile verification | per-target local cache + transfer |
| Local offline data / export | both | Yes | none | none | migration/export test | n/a |
| HTTPS server sync | both | Yes | ATS/URL configuration | none | auth, offline/retry test | manual export/import |
| HealthKit / heart rate / activity | both | Apple table governs; **gate until profile/device validation** | `com.apple.developer.healthkit` | no additional ID known; record | permissions and real data test | manual entry/import |
| WorkoutKit / workout session | both | Conditional; entitlement/runtime validation required | HealthKit/workout configuration | no additional ID known; record | exercise/battery/background test | timer/manual workout |
| GPS / background location | iPhone/Watch as API permits | Conditional; background modes not assumed | location usage strings; Background Modes if enabled | none | consent/real background test | foreground tracking |
| Core Motion | both where hardware/API supports | Usually framework-only; validate privacy/runtime | motion usage string when required | none | hardware/permission test | manual values |
| Bluetooth | both where API supports | Conditional; validate service/background profile | Bluetooth usage string; background mode if enabled | none | permission/peripheral test | manual/HTTPS data |
| Local notifications | both | Framework-level; validate device | notification authorization | none | on-device permission test | in-app reminders |
| Remote push notifications | both | **Blocked for free** by Apple capability table | `aps-environment`/APNs | service/App ID configuration when paid | paid membership/service setup | local notification + refresh |
| Haptics | both | Framework-level | none | none | hardware test | visual/audio feedback |
| Background refresh | both | Conditional; OS scheduling is not guaranteed | Background Modes where requested | none | real scheduling/battery test | foreground/manual sync |
| Siri / App Intents / Shortcuts | both where framework supports | Conditional; Siri capability is not free-table supported | Siri entitlement if required | record if Siri service enabled | Shortcuts/device test | in-app action |
| iCloud/CloudKit | both | **Blocked for free** by Apple table | iCloud containers | container/service ID when paid | paid membership/profile | private HTTPS sync/export |
| Associated Domains | iPhone/Watch as relevant | **Blocked for free** | associated-domains entitlement | none known; record | domain + profile | normal HTTPS links |
| Sign in with Apple | both as relevant | **Blocked for free** | Sign in with Apple capability | service/App ID when paid | paid membership/service | existing server login |
| HomeKit | both as API supports | **Blocked for free** by table | HomeKit entitlement | no additional ID known; record | physical home/privacy test | server API/control |

### App ID budget and extension rule

Apple’s free-account overview states a maximum of 10 App IDs, 3 registered devices, 3 installed apps per device, each expiring after seven days. The exact relationship of an installer’s re-signing operation to a multi-bundle app is not guaranteed by these documents. Therefore every spec must list **all** bundle IDs (iPhone, widgets, Watch app/extensions), include its actual observed App ID usage, and refuse to enable a new target if the available budget is unknown.

### Privacy baseline

Add only requested usage descriptions: Health share/update, location when in use/always, motion, Bluetooth, notifications, microphone/camera/photos if applicable. Explain purpose in the app, request at the moment of use, and test denied/revoked permission states. Privacy strings are necessary but never grant an entitlement.

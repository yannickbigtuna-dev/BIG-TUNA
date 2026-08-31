# Free Apple Account signing

## What is possible

After accepting the Apple Developer Agreement, an Apple Account appears in Xcode as a **Personal Team**. Apple currently documents: at most 10 App IDs, 3 devices, and 3 installed apps per device; all expire after seven days. Rebuild/re-sign and reinstall before expiry. This is device testing only, not distribution, App Store Connect, TestFlight, Xcode Cloud, ad-hoc, or Enterprise distribution. Source: [Apple Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/).

Treat an app family as a planned ID budget, not a promise that all nested targets use no capacity. The installer may register/re-sign the main bundle and extensions differently. Keep a written ledger in the app spec, build the smallest target set first, and confirm actual IDs in the installer/device before expanding an app family. Never delete an active identity just to recover an ID slot without explicit owner approval.

## Security boundary

Apple Account credentials, app-specific passwords, 2FA codes, certificates, mobileprovision files, pairing files, private keys, and session cookies are never committed, uploaded to the home server, or put into CI. Sign in only in the trusted installer/Xcode path on the owner’s machine/device. The cloud pipeline produces unsigned artifacts and can inspect them, but cannot sign them with a Personal Team safely or unattended.

## Seven-day operational routine

1. Keep a calendar reminder for day 5 after each successful installation.
2. Open the chosen installer on the Windows PC, connect/refresh as that installer requires, and re-sign the same IPA with unchanged bundle IDs.
3. Update the spec/release record with the actual signing date and expected expiry. Test launch, widget timeline, and Watch installation again.
4. If the profile is expired, re-sign/reinstall over the existing app first; do not delete it unless the installer proves an in-place update is impossible. Back up/export important data first.

Free provisioning is unsuitable for anything that must run unattended after a week. A paid Developer Program membership is required for Apple-supported distribution and many advanced services. Apple’s capability tables label what a free Apple Developer can provision; this factory treats an unavailable capability as blocked even when source can compile.

## Capability and identity policy

Use automatic signing only at the final owner-controlled signing step. Every enabled entitlement is declared in the app spec, generated project, and capability matrix. App Groups, iCloud, push, HealthKit, background modes, associated domains, and other services must never be assumed available under Personal Team. If a capability is unavailable, choose an explicit fallback such as local storage, app-to-app transfer, a signed-in HTTPS API, or a user-initiated refresh.

Watch components add a physical paired-watch requirement and their own provisioning/install uncertainty. No current factory policy claims that an IPA sideloader preserves embedded Watch bundles; physical validation is mandatory before treating Watch delivery as supported.

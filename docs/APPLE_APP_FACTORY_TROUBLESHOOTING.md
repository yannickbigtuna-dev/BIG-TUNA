# Apple App Factory troubleshooting

| Failure point | Evidence to collect | Safe response |
|---|---|---|
| Spec validation fails | validator output and spec path | fix identifiers/toggle/version; never invent a bundle ID or remove an enabled target |
| XcodeGen/project mismatch | generated-project diff, target graph | regenerate deterministically; update template/spec together |
| macOS CI compile/test failure | retained CI log/artifact | fix source/configuration and rerun; no release promotion |
| IPA lacks widget/Watch component | archive inspector output | treat release as failed; restore no `latest`; do not ship a stripped IPA |
| CI upload unavailable | missing/failed secret connection | use GitHub artifact only; configure a narrow destination later |
| Upload checksum mismatch | local/remote SHA-256 | reject upload, retain prior latest, investigate transport/path |
| Home page returns 401/403 | owner auth log with redacted identity | sign in as configured owner; do not make releases public to diagnose |
| Safari downloads but cannot install | iOS behavior | expected for Personal Team; use approved installer path |
| Installer sees no iPhone | installer/iTunes/Apple Devices state | unlock, trust cable/computer, update official prerequisites; do not disable Windows protections |
| Apple Account/2FA prompt | on-device/installer prompt | complete only in installer/Apple UI; never paste credentials into a script |
| “Untrusted developer” / Developer Mode | iOS Settings prompt | trust the shown developer and enable Developer Mode as requested; do not bypass it |
| App expires | recorded signing date / launch failure | re-sign/reinstall the same identity before day 7; verify data retained |
| Widget missing/stale | widget gallery/timeline observations | verify extension survived archive/signing, reload timeline, test on device |
| Watch app/complication absent | paired Watch app and archive tree | mark installer unsupported for Watch; do not claim support; retain iPhone release separately only if spec permits |
| WatchConnectivity stalls | device reachability and queued-transfer logs | queue durable transfer, reconnect devices, test later; avoid aggressive retries |
| Health/background/location denied | OS authorization/state | show limited mode and user instructions; never imply background behavior is guaranteed |
| In-place update rejected | old/new IDs, team, App Group, schema evidence | preserve old app/data, export first, diagnose identity mismatch; delete only as last resort with owner approval |

When reporting a failure, record app slug/version/build, iOS/watchOS, installer/version, target set, exact non-sensitive error, archive-inspector result, signed date, and whether the previous release still launches. Never include credentials, certificates, pairing files, UDIDs, 2FA codes, or release URLs for a private server in a public issue.

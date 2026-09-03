# BIG TUNA Lights 1.1.2 (4)

Release date: 2026-09-03

## Changed

- Removes the unverified Apple Watch companion and Watch widget targets from
  this iPhone-only release.
- The owner explicitly authorized this removal after Sideloadly reported an
  invalid companion app bundle identifier.
- Keeps the iPhone app, Home Screen widget, and Control Center control.

## Included components

- iPhone app: yes
- Home Screen widget: yes
- Lock Screen widget: no
- Control Center control: yes, through the iPhone widget extension
- Apple Watch app, complication, and control: no

## Compatibility

- Minimum iOS: 18.0
- SHA-256: `bd7c0cdf1efd2646e30bfd16327945986e084a126e00138281401df1d8adde19`

## Installation and free-signing notice

This is a private Personal-Team test release. It cannot install directly from
Safari; use Sideloadly on the trusted Windows PC. The free Apple signature
expires after seven days and must be refreshed. The factory prepares the widget
extension for the locally detected Sideloadly Personal Team identity, so no
manual identifier editing is required. The actual Personal Team suffix is not
recorded.

## Data and migration

- Data compatibility: App Group keys and schema version 1 are preserved; no
  data migration is required.
- Retired Watch bundle identifiers are retained only in the factory spec for
  identity history and are not included in this release.

## Validation status

- CI build: passed ([run 33698060467](https://github.com/yannickbigtuna-dev/BIG-TUNA/actions/runs/33698060467))
- IPA target inspection: passed
- iPhone physical test: not tested
- Home Screen widget and Control Center discovery: not tested

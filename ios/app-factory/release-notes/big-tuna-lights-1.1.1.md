# BIG TUNA Lights 1.1.1 (3)

Release date: 2026-09-02

## Changed

- Prepares the embedded bundle identity for Sideloadly so iOS can discover the Home Screen widget and Control Center control after signing.
- Preserves the released app identity, App Group, targets, and shared data contract.

## Included components

- iPhone app: yes
- Home Screen widget: yes
- Lock Screen widget: no
- Control Center control: yes, through the iPhone widget extension
- Apple Watch app / complication: included; physical installation remains unverified

## Compatibility

- Minimum iOS: 18.0
- Minimum watchOS: 26.0
- SHA-256: `bbfecaf44e6ac2fe85d8650c1aca783f113507224cc999136503e1b22fd6f2e7`

## Installation and free-signing notice

This is a private Personal-Team test release. It cannot install directly from Safari; use the documented Sideloadly path. Its free Apple signature expires after seven days and must be refreshed/reinstalled. Do not treat this release as signed or physically validated until the owner completes the device checks.

## Data and migration

- Data compatibility: preserved App Group keys and schema version 1; no migration is required.
- Required action: install/update in place after the build is available, then add the widget and Control Center control on the iPhone.

## Validation status

- CI build: passed ([run 33696632964](https://github.com/yannickbigtuna-dev/BIG-TUNA/actions/runs/33696632964))
- IPA target inspection: passed
- iPhone physical test: not tested
- Home Screen widget and Control Center discovery: not tested
- Watch physical test: not tested

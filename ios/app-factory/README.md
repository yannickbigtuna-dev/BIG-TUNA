# Apple App Factory workspace

This folder is the reusable native Apple project factory. Each app starts with a copied, reviewed `specs/APP_SPEC_TEMPLATE.yml`; its spec is the durable source of truth for identity, targets, entitlements, versions, data migrations, and device-validation status.

Use the tooling package to validate a spec, generate the Xcode project, build/inspect an unsigned IPA, write a release record, and prepare a checksum-verified installer handoff. Read [the operating manual](../../docs/APPLE_APP_FACTORY.md), [free-signing rules](../../docs/APPLE_FREE_SIGNING.md), and [installation guide](../../docs/IPHONE_AND_WATCH_INSTALLATION.md) first.

Do not put Apple credentials, `.p12`, `.mobileprovision`, pairing files, device IDs, 2FA codes, or release artifacts in this directory. No cloud build or installer result is considered verified until it is recorded in the app spec’s `factory.lastSuccessfulBuild` and physical acceptance fields.

When modifying an existing app, preserve every released bundle ID and data store. Add a migration/export plan before changing persisted data. A requested target/capability must be enabled explicitly in the spec and may not be silently omitted by the generator or signing workflow.

# Home-server private Apple app distribution

## Security model

Release files live below the ignored `data/apple-app-factory/releases` root, not under the public static `apps/` tree. The server’s Apple App Factory routes must require the configured owner account and validate a conservative slug/version/file allowlist before opening a file. The web UI contains no release secrets, source, CI logs, signing materials, credentials, or raw server paths.

The intended layout is:

```text
<private release root>/<slug>/
  latest.ipa
  manifest.json
  icon.png
  releases/<version>/<app-name>.ipa
  releases/<version>/release-notes.txt
  releases/<version>/sha256.txt
```

`index.json` and an optional AltStore/SideStore source are generated metadata, available only after explicit owner approval and installer compatibility validation. They must point only to authenticated HTTPS URLs; neither is evidence that Safari can install a free-signed IPA or that Watch bundles are supported.

## Publishing contract

1. CI uploads build outputs as GitHub artifacts first.
2. CI creates release metadata, validates the IPA structure and expected nested extensions, and calculates SHA-256. Manifest-schema validation, release-note validation, and repository secret scanning are still review requirements, not implemented CI checks.
3. Only when narrowly scoped repository secrets provide a hardened SSH destination/key for this release root does CI upload a new immutable version directory.
4. The destination verifies SHA-256. Only then may a single atomic promotion update `latest.*` and catalogue metadata.
5. A failed job, invalid upload, checksum mismatch, or missing enabled target leaves the prior `latest` untouched. Previous releases remain immutable.

No deployment secret is supplied in this repository and no upload has been exercised. Until the owner configures a restricted destination and CI connection, builds remain GitHub artifacts only.

## Required configuration (names only)

Use the factory `.env.example` and repository-secret documentation supplied with the tooling/CI package. The intended values are a private release root, public base URL only if deliberately approved, owner username, SSH host/user/port, and a directory-restricted private key. Never place Apple credentials in these settings.

Before enabling deployment secrets, create a dedicated non-administrator deploy account whose key is restricted in `authorized_keys` with a **forced command** (a purpose-built publish receiver) and `no-pty`, `no-port-forwarding`, `no-agent-forwarding`, and `no-X11-forwarding`. The receiver must accept only the factory’s expected immutable-release input below the configured release root, validate slug/version/path arguments, and invoke no arbitrary shell. It must not provide an interactive shell, access to the repository or other `data/` directories, or a general `scp`/remote-command escape hatch. The current generic SSH workflow does not itself enforce this forced-command contract; do not configure its deployment secrets until the upload path has been adapted and independently reviewed against this requirement.

The one-time GitHub secret checklist is: `APPLE_APP_FACTORY_DEPLOY_HOST`, `APPLE_APP_FACTORY_DEPLOY_USER`, `APPLE_APP_FACTORY_DEPLOY_ROOT`, `APPLE_APP_FACTORY_DEPLOY_REPO`, `APPLE_APP_FACTORY_DEPLOY_SSH_KEY`, and `APPLE_APP_FACTORY_DEPLOY_KNOWN_HOSTS`. The last value is a reviewed, pinned `known_hosts` entry for the exact SSH host/key; it replaces runtime `ssh-keyscan`. Obtain and verify the host fingerprint through a trusted out-of-band channel before saving it, and rotate/review the secret when the host key changes.

## Verification

For each release, confirm: owner access is required; the catalogue hides other users’ releases; every download URL returns the expected content type/bytes; local and uploaded SHA-256 match; prior version remains accessible to the owner; `latest` points to the new verified version; no logs or secrets are reachable; and an unsuccessful build cannot change `latest`.

The release page must display version/build, date, minimum iOS/watchOS, components, SHA-256, notes, prior releases, build status, installation instructions, remaining manual steps, and a prominent seven-day expiration warning.

# Apple app registry

`config/apple-apps.json` is the server-owned registry of native Apple app
workspaces that may be added to a local BIG TUNA Codex session. It is a
development-tooling registry only: it does not configure the running server,
Apple signing, releases, or deployment.

## Current entry

| Slug | Workspace | Platforms | Server contract | Native contract | Identity |
| --- | --- | --- | --- | --- |
| `big-tuna-lights` | `C:\APPS\YannickLightsIOS` | iOS, watchOS, WidgetKit, Control Center | `docs/openapi.yaml` | `API-DISCOVERY.md` | `ca.yannickmorgans.bigtuna.lights` plus widget/Watch IDs |

Yannick Lights retains App Group
`group.ca.yannickmorgans.bigtuna.lights`. Its released target graph and all
bundle identifiers remain governed by
`ios/app-factory/specs/big-tuna-lights.yml`; the registry is not a replacement
for that durable app specification.

The registered GitHub repository is `yannickbigtuna-dev/YannickLightsIOS`.
Backend usage is listed in the JSON entry and detailed in the app's
`docs/BACKEND_INTEGRATION.md`. The registry records the owner-provided
Xcode Cloud configuration (`main` changes trigger iOS/watchOS archives) and
the App Store Connect/TestFlight internal group `Yannick` as reported setup
metadata; Windows cannot verify Apple-side processing or physical delivery.

## Registry rules

- `schemaVersion` is currently `1`.
- Each `slug` must be unique and use lowercase letters, digits, and hyphens.
- `workspacePath` must resolve to an existing Git worktree directly below
  `C:\APPS`. The launcher rejects missing paths, paths outside that root, and
  directories without `.git`; it never substitutes `C:\` or discovers folders
  broadly.
- `serverApiContract` is relative to this server repository. `nativeApiDiscovery`
  is relative to the registered app workspace.
- Do not place credentials, device tokens, release URLs, provisioning assets,
  or private data in this file.

Use `tools\Launch-BigTunaCodex.ps1 -DryRun` to review the exact `codex -C
C:\SERVER --add-dir ...` command before launching. Use
`tools\Sync-AppApiContract.ps1 -WhatIf` to preview the optional marked copy of
the server API contract into an app workspace.

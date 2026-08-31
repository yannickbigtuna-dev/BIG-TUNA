# BIG-TUNA Codex Instructions

This is a live website repo. The live server machine auto-pulls from GitHub and updates the Cloudflare Tunnel site.

## Instruction precedence and worktree safety

- Current user and task restrictions define the permission boundary and override conflicting default Git or deployment operations below; they do not weaken mandatory safety or coordination requirements. Run only operations that the current task permits.
- Treat every pre-existing modified or untracked file as important user-owned unfinished work. Do not delete, discard, overwrite, revert, restore, or clean it, and do not change branches to work around it.
- Preserve concurrent agent edits. If a safe merge is unclear, leave the existing file unchanged and report the issue.

At the start of every session:

1. When the current task permits `git pull`, run `git pull origin main` first. If it is prohibited, skip it without substituting another Git operation.
2. Read `CODEX_CONTEXT.md` before making changes. It is the persistent project map for Codex.
3. Read `docs/AI-WORKFLOW.md` for task routing and risk modes.
4. Read each relevant `.codex/skills/*/SKILL.md` before editing.
5. Consult `README.md` for current behavior and operational commands when relevant.

## Mandatory agent workflow

For every requested change:

1. Keep the root thread on the most capable configured model. The root owns architecture, coordination, integration, and final review.
2. Before coding, the root must write a thorough implementation spec defining scope, constraints, file/module ownership, approach, and acceptance checks.
3. Split work into the smallest independent packages possible, each with a disjoint write scope.
4. Delegate coding to the project implementer agent. When at least two packages are independent, spawn all implementers in the same parallel round before waiting; parallel agents must never edit the same files.
5. Tell every implementer that it is not alone, must preserve concurrent edits, must stay within its ownership, and must report changed paths and checks run.
6. While agents run, the root does only useful non-overlapping work, then reviews the actual combined diff rather than trusting summaries.
7. Delegate independent acceptance checks to project tester agents in parallel when useful, but testers never replace root review.
8. The root performs final validation against the original spec and loops targeted implementation and testing until the work passes.

## Modes, roles, and execution plans

- **FAST** covers small UI or copy changes and isolated, low-risk fixes; inspect narrowly and run focused checks.
- **STANDARD** covers normal features and bugs; inspect related integrations and test the happy path plus a relevant failure path.
- **DEEP** covers authentication, remote command execution, data changes, deployment, networking, Cloudflare, MCP, and device safety; threat-model first, preserve rollback, and broaden validation.
- Default to FAST unless scope or risk calls for STANDARD or DEEP. These modes, the role guides in `docs/agents/`, and the task procedures in `.codex/skills/` are supplemental: they add depth and specialist guidance but cannot bypass the mandatory root spec, disjoint implementer delegation, tester independence, or root diff review above.
- For changes touching more than three files or involving deployment or live data, create or update `docs/exec-plans/active.md` before coding. Preserve every unfinished plan: extend it only for the same work, and otherwise leave it intact and report the coordination issue. An execution plan supplements rather than replaces the root implementation spec.

## Completion and Git defaults

For every requested change, subject to the current task's permissions:

1. Make the requested edits.
2. Update `CODEX_CONTEXT.md` in the same change if architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards changed.
3. Run `git status` and `git diff`.
4. If the change is complete, commit with a clear message.
5. Push to main using `git push origin main`.
6. Tell the user what changed and whether it was committed and pushed.

Do not restart or deploy the live server unless the task explicitly authorizes it. A push to `main` can affect the live site through the server's automatic update workflow, so never push when the current task forbids deployment or Git writes.

Never commit:

- `.env` files
- passwords
- API keys
- `node_modules`
- local cache/build junk
- tokens or tunnel credentials
- private production data or logs
- `mcp-server/token.txt`

Do not force push.
Do not rewrite history.
If there is a merge conflict, stop and explain it.

The completion report must concisely state what changed, every created or modified path, checks actually run and their results, remaining risks or manual deployment steps, and whether anything was committed, pushed, or deployed. Include the exact final Git status when requested. Never claim a check passed unless it was run.

## Apple App Factory mandatory workflow

For any native iPhone, WidgetKit, Lock Screen, Live Activity, Apple Watch, complication, HealthKit, workout, location, Bluetooth, notification, or Apple-signing request, operate in DEEP mode. Before editing, read `docs/APPLE_APP_FACTORY.md`, `docs/APPLE_FREE_SIGNING.md`, `docs/APPLE_CAPABILITY_MATRIX.md`, `docs/IPHONE_AND_WATCH_INSTALLATION.md`, `docs/HOME_SERVER_APP_DISTRIBUTION.md`, the troubleshooting guide, and the target app’s `ios/app-factory/specs/<slug>.yml` (if it exists).

- Treat the app spec as the stable contract for app slug, every bundle ID, App Group, enabled targets, capabilities, storage schema, version/build, distribution access, and known limitations. Preserve released identity/data; add explicit migrations and export/backup support before changing persisted formats.
- Use Swift/SwiftUI and deterministic project generation. A requested extension/capability must be explicitly represented in the spec and verified in the generated archive. Never silently remove a target, entitlement, Watch component, or capability to make a build/signing error pass.
- Apple Personal Team work is seven-day device testing only. Do not claim App Store/TestFlight/ad-hoc distribution, direct Safari installation, unattended cloud signing, or Apple Watch installer support unless the exact workflow has been physically validated and recorded.
- Never commit or upload Apple Account credentials, app-specific passwords, 2FA codes, signing certificates, provisioning profiles, private keys, pairing files, device identifiers, or release-server credentials. CI builds unsigned artifacts; signing occurs only in the owner-controlled installer/Xcode path.
- Private release files remain outside public static content and require owner authentication. A failed build/upload/checksum/extension inspection must not alter `latest`; retain immutable old releases. Do not make releases public without explicit user authorization.
- For every release, validate config/spec, tests, target inspection, manifest, checksums, private access, and a relevant failure path. Record actual physical iPhone/widget/Watch results and seven-day signing date/expiry; do not infer them from CI success.


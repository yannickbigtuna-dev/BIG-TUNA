# CHALLENGERS App Store readiness implementation spec (2026-09-12)

## Scope and constraints

Fix participant names, cross-account membership freshness, owner deletion and member leaving, Strava connection/refresh failures, browser invitation continuation, installed-app QR handoff, and add six-letter invitation codes. Preserve existing visual language, scoring, fixed Yannick/Emma challenge, accounts, and persisted identities. Review related release/privacy/security defects. Server changes live in the isolated C:/APPS/BigTunaAppStore worktree; C:/SERVER and its pre-existing untracked artifacts remain untouched until the user explicitly authorizes delivery. On 2026-09-12 the user authorized commit, push, and deployment, which follow the documented backup, PM2 reload, and health-check procedure.

## Existing evidence

Participant DTOs omit usernames and the native fallback prints opaque user IDs. Native foreground refresh only updates the fixed challenge. Dashboard detail fetching fails as a group if any challenge disappears. Member leaving reuses deletion-specific error strings. HTTPS invites have no Associated Domains support. Native Strava athlete IDs are String despite upstream numeric IDs. Server/runtime behavior and website lifecycle require regression coverage.

## Ownership and approach

1. Backend implementer owns server.js, lib/challenge-accounts.js, relevant server tests and a new association helper if useful. Serialize current usernames only for authorized challenge participants. Ensure owner-only delete and member-only leave exist, atomically clean related state, and never expose deleted challenges. Add six uppercase A-Z letter codes alongside existing invite links: collision-checked cryptographic generation, hashed persistence, seven-day expiry, shared revocation/regeneration, throttled preview and acceptance. Existing POST /api/challenge-invites/preview and /accept accept exactly one token or code; create-invite returns additional code. Preserve old token invitations. Add public JSON AASA routes for /challenge-invite/ using the existing app bundle ID and an explicitly configured Apple application/team identifier; no invented team ID. Inspect redacted Strava DTO consistency and fix proven server faults. No docs or website edits.
2. Native implementer owns all Swift app/widget/test source, native plist/entitlement/project/workflow changes. Consume optional participant username with a human fallback. Reconcile authoritative challenge membership on foreground and periodic active refresh; avoid overlapping refreshes, tolerate missing details, clear deleted/left challenge and widget state, guard account/session races, distinguish leave/delete errors. Decode Strava numeric/string athlete ID, terminate loading correctly, preserve compact existing settings appearance with connected/disconnect information. Implement six-letter join entry and sharing under existing invitation UI using the contract above, preserve explicit Join consent, resume after authentication, handle universal links and legacy scheme/fragment links. Add privacy manifest and focused native regression tests where possible. Do not edit ENDPOINTS/README/release docs; report account deletion/privacy gaps for integration.
3. Browser implementer owns apps/challengers/*, apps/challenge-invite/*, relevant browser/UI tests. Preserve appearance, render usernames, refresh visible membership without reload and reconcile deletion/leave, support the same code preview/accept contract, include code in invite sharing, fix skipped-auth/invite continuation, concise Strava status/disconnect with settled error/loading states. No shared auth.js mutation without coordination; report dependencies. Test with fake services in isolated browser harness, never production.
4. Root owns API/OpenAPI/context/README/ENDPOINTS/release documentation, spec and plan updates, additional review and independent validation. Integrate any additional confirmed App Store blockers through separately assigned ownership.

## Security and rollback

Short codes have lower entropy: enforce per-client/account limits, no plaintext persisted codes, collision checks and indistinguishable unavailable responses; preview exposes only existing limited metadata. Accept only caller membership and never client-supplied role. Preserve bearer isolation and no-store, reject malformed credentials and path IDs, keep Strava credentials server-side. Never test using real accounts or connect/disconnect real Strava. No destructive migration. Changes remain reviewable uncommitted Git diffs and deployment is deferred.

## Acceptance checks

- Two isolated accounts: owner creates, other previews and explicitly joins by link/QR/code; both see usernames and membership after refresh. Duplicate acceptance stays idempotent.
- Member leaves and owner observes removal; member cannot delete; owner cannot leave; deletion disappears for remaining users, including list/detail races and repeated stale-screen operations.
- Six letters normalize case/whitespace; malformed/unknown/expired/revoked/full codes fail safely; regeneration invalidates both prior credentials; unauthorized callers cannot mutate invites.
- Browser skip/login/signup/reload retains pending invitation without silently joining; dismissal works; deep links validate origin/path/token and arrive in native confirmation after login.
- Strava numeric IDs decode, status renders compactly, disconnect matches API, cancellation/network/unauthorized errors end progress, account switches do not restore stale data.
- No scoring/theme/feature removal. Privacy/account-deletion, entitlements, URL schemes, widget resources and release settings are reviewed; signed Apple validation is explicitly separated from Windows checks.
- Focused Node behavioral and browser tests, full Node suite when safe, OpenAPI/schema/project/manifest parsing, native test source review and actual macOS tests only if available without push/deploy. Root reviews combined diff and whitespace/security checks; document honest remaining release gates.

## Progress

- [x] Inspected repositories and identified primary integration defects.
- [x] Created isolated server checkout and disjoint implementation spec.
- [x] Implemented app, backend and website corrections.
- [x] Completed independent acceptance, root diff review and regression checks.
- [x] Prepared final per-path review summary and release checklist.
- [x] Committed and pushed server `7e2bdbf` and iOS `c95d07b`, then deployed the server through its auto-updater. The live `apps-server` restart and localhost/public CHALLENGERS checks passed on 2026-09-12.
- [ ] Configure the real Apple Team/application identifier in the ignored production `server.env` as `CHALLENGE_AASA_APPLICATION_ID`, then verify a signed physical-device Universal Link. The source intentionally returns 404 for the association file until this real identifier is supplied rather than guessing it.

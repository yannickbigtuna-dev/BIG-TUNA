# CHALLENGERS accounts and invitations — implementation specification

## Scope and architecture

Add native registration through existing BIG TUNA `/api/auth/register`; account
identity and sessions remain in the website account store. Do not create a second
identity database. Preserve existing passwords, identities, Strava connections,
scoreboards, reviews, widgets, bundle IDs and capabilities. Login branding is a
large CHALLENGERS heading with smaller `Train together.` below it.

Generic account challenges gain manager-created, reusable, seven-day invitations.
One current invitation per challenge; regenerating revokes the prior link. Store
only a SHA-256 digest and expiry inside existing serialized challenge state.
Only explicit authenticated acceptance adds the current account as member; never
accept a caller-supplied user ID or role. Repeat acceptance is idempotent and the
50-member limit is checked inside the same mutation. The special fixed Yannick /
Emma public scoreboard remains a two-person system and is not inviteable.

Shared contract (all responses no-store, errors safe JSON):

- POST `/api/challenges/:id/invites`, bearer, `{}` -> 201
  `{url, token, expiresAt, qrDataURL}`. Canonical URL:
  `https://yannickmorgans.ca/challenge-invite/#token=<base64url-32-byte-token>`.
- DELETE `/api/challenges/:id/invites`, bearer -> 200 `{revoked:true}`.
- POST `/api/challenge-invites/preview`, public, `{token}` -> 200
  `{challengeId,name,participantCount,expiresAt}`. No private member/activity data.
- POST `/api/challenge-invites/accept`, bearer, `{token}` -> 200
  `{challenge: <existing detailed Challenge shape>, alreadyMember: boolean}`.
- Bad/expired/revoked/deleted invitations -> 404/410; full -> 409; unauthorized
  -> 401/403; bounded public and account rate limits -> 429.

Browser invite page clears the fragment into sessionStorage (reload/sign-in
continuity), previews before authentication, then uses shared Auth for sign-in or
registration. After authentication show Join / Not now; never auto-join. Offer
`yannickchallenge://invite?token=...` only via user tap. Native app preserves one
pending invitation across sign-in/relaunch, validates recognized URLs strictly,
previews and requires confirmation, handles denial/errors/retry, and opens the
joined challenge. Native sharing uses ShareLink and a locally generated QR or the
server-provided QR. Website `/challengers/` lists caller challenges and supports
manager link/QR generation/revocation, so a recipient can use the whole flow in a
browser. Reuse site tokens/topbar/Auth and add a discoverable launcher entry if
required by existing conventions. Do not add third-party QR services.

## Ownership

- Backend implementer: `server.js`, `lib/challenge-accounts.js`, new narrowly
  scoped auth/invite helpers if needed, `test/challenge-invites*.test.js` and
  existing challenge server/service tests. Harden registration/login input shape,
  size and rate limits; retain established password compatibility.
- Website implementer: `apps/challenge-invite/*`, `apps/challengers/*`,
  `apps/auth.js`, narrowly scoped launcher/topbar changes, browser tests.
- iOS implementer: app Swift sources, tests, project/config only as necessary,
  app `ENDPOINTS.md`. No new signing capability; use existing URL scheme.
- Root: this spec, shared active-plan append, API/OpenAPI/context docs, security
  and combined-diff review, integration validation, selective commits/pushes.

All agents preserve concurrent edits, stay in ownership, and do not commit,
push, restart, touch live data or make real account/membership writes.

## Threat model and acceptance

Opaque tokens resist guessing; fragments avoid proxy logs/referrers. No password,
session, token digest or Strava credentials in previews/logs. Share only challenge
name/count/expiry. Input bounded before hashing/decoding; manager authorization on
mint/revoke and current account authorization on accept. State adapter migration
must preserve additive fields. Expiry/revocation/fullness checked server-side.
Browser uses textContent and fixed trusted links; no arbitrary redirects. Native
auth failures clear invalid credentials without silently losing the invitation.

Test register -> website login -> challenge profile with a single identity;
duplicate/invalid signup; existing login compatibility; unauthorized mint/revoke;
public preview privacy; invalid/expired/revoked/deleted/full invitation; concurrent
and repeated acceptance; no role escalation; state persistence across reload.
Browser-test guest preview, sign-in/signup return, explicit accept/decline, stale
session, API failure, link/QR UI, narrow mobile layout. Test native URL parsing
and pending-state behavior where runnable. Run focused tests, full server tests,
syntax/contract checks, review actual diff. Windows cannot certify an iOS build;
use available macOS CI if configured and report actual remaining device checks.

## Deployment and rollback

User requests website and app updates end to end. Complete tested source changes
and push both repositories to main per repository delivery rules. Back up live
data before an authorized server restart; never modify production accounts to
test. Keep rollback code commit and additive state compatibility. A source push
is not proof of iPhone installation. Existing unrelated active plans remain.

## Progress

- [x] Inspected both repositories and existing identity/challenge storage.
- [x] Defined shared contract, ownership, failure behavior and acceptance checks.
- [x] Implement backend, website and iOS packages.
- [x] Complete root diff/security review and local validation (164 server tests).
- [ ] Update docs and deliver verified commits to both remotes.

Implementation review added scrypt for new/reset passwords with legacy login
compatibility and race checks around asynchronous password derivation. The app
now declares its existing URL scheme as a typed Info.plist array in both build
configurations. A macOS simulator CI workflow validates compilation, tests,
widget presence and the built URL scheme. Physical iPhone checks remain manual.
The three implementers were interrupted by their account usage limits; the root
completed integration corrections and ran the full validation suite.

Rollback must preserve scrypt verification for accounts created after this
release; reverting to a SHA-256-only login implementation would prevent those
accounts from signing in. Invitation fields are additive and may remain stored.

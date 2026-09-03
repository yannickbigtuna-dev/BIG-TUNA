# Previous Completed Execution Plan — Trivia

## Goal

Make fixed-length Trivia topic runs deliver the selected 10, 25, or 50
questions without falsely completing when live generation temporarily runs dry,
and add an adjustable per-question time limit from 1 second through unlimited.

## Existing behavior

- The browser calls `finishRun()` after eight consecutive buffer misses even
  when a fixed run has answered only a few questions.
- The server coalesces same-topic refills, but later waiters can reuse the raw
  generated array after the first waiter has already claimed it, duplicating a
  successful response.
- Each server refill hard-codes one generated question even when the browser
  asks for a larger ready-ahead batch.
- The question timer and speed-score calculation are both hard-coded to 20
  seconds.

## Proposed changes

- Introduce a small dependency-injected topic-pool coordinator that keeps
  keyed inventory, makes refill size demand-aware, and atomically claims every
  returned question exactly once.
- Route custom-topic requests through that coordinator while preserving the
  existing Luna generation and two-pass verification boundary.
- Keep fixed runs open across transient generation failures, use a slower
  bounded retry after the existing failure threshold, and complete only at the
  selected target. Preserve current Endless-mode completion semantics.
- Add an accessible range control whose positions 1-60 mean seconds and whose
  rightmost position means unlimited. Snapshot the setting per run and keep the
  existing 20-second scoring window independent from the selected timeout.
- Add deterministic coordinator tests and a browser regression test with
  mocked Trivia APIs; make no paid OpenAI calls.

## Ownership

- Server implementer: `lib/trivia-topic-pool.js`, `server.js`.
- Client implementer: `apps/trivia/index.html`.
- Test implementer: `test/trivia-topic-pool.test.js`,
  `test/trivia-app.test.js`.
- Root integration: `CODEX_CONTEXT.md`, this plan, combined diff review,
  validation, commit, and push.

## Risks and rollback

- Larger custom-topic batches can increase latency or token use; cap demand at
  the route's existing maximum and retain partial twice-verified inventory.
- Infinite time must not accidentally award an unlimited speed bonus; scoring
  remains on the prior fixed 20-second window.
- A persistent upstream outage can leave a fixed run waiting; the visible Quit
  control remains available and retries slow to the server cooldown cadence.
- Rollback is the single task commit; no persisted data migration is involved.

## Validation

- Two concurrent same-topic claims never receive the same question.
- Refill generation receives the requested demand and keeps exclusions.
- After two answered topic questions and repeated mocked failures, a 10-question
  run remains active, resumes when generation recovers, and reports 10 total.
- Slider default/endpoints and 1s, 60s, and unlimited runtime behavior pass in
  a browser test.
- Run focused Node tests, then `npm test`, syntax checks, `git diff`, and
  secret/unrelated-file review.

## Progress checklist

- [x] Reproduce and isolate the early-finish and duplicate-claim failures.
- [x] Define disjoint implementation ownership and acceptance criteria.
- [x] Implement server coordination.
- [x] Implement fixed-run retry and timer slider UI.
- [x] Add regression tests.
- [x] Complete root review and validation.
- [x] Finalize the scoped patch for commit and push.

---

# Active Execution Plan — Yannick vs Emma Strava Challenge

## Goal and mode

Implement the requested challenge end to end in DEEP mode: secure two-person
Strava OAuth, local activity synchronization, centralized qualification and
weekly scoring, immutable finalized weeks, idempotent Monday result processing,
Resend emails, public homepage scoreboard/history/statistics, and Yannick-only
administration/testing controls.

The user confirms written Strava approval covering the otherwise-restricted
public cross-athlete display and retained historical snapshots. The feature must
still follow Strava's OAuth, scope, token-refresh, rate-limit, and branding
requirements.

## Existing behavior and integration points

- The app is one CommonJS Node HTTP process. There is no framework, ORM, build
  step, or cron package.
- Runtime state is gitignored JSON under `data/`, with atomic temp-file renames.
- `/` serves `apps/index.html`. Its isolated rolling clock is replaced; its date,
  weather, Ask Emma control, launcher grid, auth widget, and corner tools remain.
- The current homepage is a non-scrolling, uniformly scaled viewport. The
  challenge requires normal vertical scrolling while retaining fixed-bar safe
  areas and no horizontal overflow at 320px.
- Resend delivery is available through `lib/assignment-coach.js#sendEmail`.
- Private admin APIs and `/admin/` use bearer auth plus an exact case-insensitive
  `yannick` username gate.
- Existing jobs are in-process timers started after `server.listen()`; PM2 runs a
  single process and Cloudflare already routes the public hostname to it.
- Real environment values live in gitignored `server.env`; tracked examples live
  in `server.env.example` and are loaded by `ecosystem.config.cjs`.
- Pre-existing modified/untracked files are user-owned. In particular, do not
  touch or stage `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/skills/`,
  `docs/AI-WORKFLOW.md`, `docs/agents/`, `apps/emma/`, or `query`.

## Architecture and data contract

### Durable state

Use a versioned `data/strava-challenge/state.json`, created automatically on first
use and written by one serialized mutation queue with unique temporary filenames.
Keep a last-good backup. The state contains:

- immutable participants `yannick` and `emma` with fixed red/blue identity;
- private participant emails and connection/sync status;
- encrypted access/refresh tokens, expirations, scopes, athlete IDs, and minimal
  athlete metadata;
- SHA-256 invitation and OAuth-state hashes with expiry/use/revocation metadata;
- activities keyed by Strava activity ID, including normalized scoring fields;
- finalized week snapshots keyed by Halifax Monday date;
- scheduler/finalization and per-recipient email-delivery state.

The public serializer is an allowlist and must never include emails, credentials,
invite/state hashes, OAuth material, or private configuration. Season points are
derived from unique finalized weeks rather than incremented independently.

### Domain rules

- Fixed timezone: `America/Halifax`; weeks are `[Monday 00:00, next Monday
  00:00)` in that timezone, including DST transitions.
- Distance thresholds: Run 4000m, Swim 3000m, Walk 2000m.
- Time thresholds: Gym 1200s, Paddle/Row 1800s, Climbing 3600s.
- Official `sport_type` enum mapping is centralized. Run includes `Run`,
  `TrailRun`, `VirtualRun`; gym includes `Workout`, `WeightTraining`, `Crossfit`,
  `HighIntensityIntervalTraining`; paddle/row includes `Canoeing`, `Kayaking`,
  `Rowing`, `VirtualRow`, `StandUpPaddling`; climbing is `RockClimbing`;
  `Swim` and `Walk` map directly. `sport_type` is primary with `type` only as an
  enum fallback. Unsupported activities remain visible and non-qualifying.
- Distance activities and paddle/row use `moving_time` for challenge time,
  falling back to elapsed time if absent. Gym and climbing use `elapsed_time`
  because rest/belay time is representative, falling back to moving time.
- Every qualifier is exactly one activity. Winner order is qualifying count,
  exact qualifying duration seconds, then true tie. Only qualifying activity
  time participates in the tiebreaker.
- Current weeks are live and award no point. Finalized weeks embed all activity
  rows and computed stats so later edits/deletes do not alter the official result.

### OAuth, sync, and scheduling

- Email links use `/strava-connect/#token=<raw-token>` so raw invites never reach
  HTTP logs or referrers. The static page clears the fragment, validates it with a
  POST body, presents disclosure/consent, then follows a generated official OAuth
  authorize URL.
- Invite tokens and OAuth state are independent, random, expiring, single-use,
  server-mapped values. The invitation—not Strava profile text—selects the
  participant.
- Request only `activity:read_all`, validate the callback and token response
  scopes, exchange the one-time code, prevent the same athlete ID being attached
  to both participants, encrypt credentials, consume invite/state, and attempt an
  initial historical sync.
- Refresh access tokens at or inside Strava's one-hour refresh window and always
  persist the newest returned refresh token.
- Fetch `/api/v3/athlete/activities` with `per_page=100`, complete pagination,
  challenge-range `after`/`before` bounds, timeouts, rate-limit parsing, safe
  errors, and participant-level in-flight locks. Regular sync re-fetches the
  current and any unfinalized previous week; only a successful complete window
  may mark missing local rows deleted. Homepage reads never call Strava.
- Start a scheduler beside existing jobs. It performs a delayed startup catch-up,
  periodic incremental sync, and polls Monday eligibility at/after 08:00 Halifax.
  Finalization synchronizes both participants through Sunday, aborts if either
  final sync fails, snapshots once, derives season score, and delivers result mail.
- Finalization is keyed by week start and serialized. Email state plus stable
  Resend `Idempotency-Key` values prevent duplicate result/invitation delivery.

### API contract

Public:

- `GET /api/strava-challenge/public`
- `GET /api/strava-challenge/public/weeks/:YYYY-MM-DD`
- `POST /api/strava-challenge/oauth/prepare` with an invite token in the JSON body
- `GET /api/strava-challenge/oauth/callback`

Yannick-only admin:

- `GET /api/admin/strava-challenge/status`
- `PUT /api/admin/strava-challenge/config`
- `POST /api/admin/strava-challenge/invites/:participant/send`
- `POST /api/admin/strava-challenge/invites/:participant/generate`
- `POST /api/admin/strava-challenge/sync/:participant` (`all` supported)
- `GET /api/admin/strava-challenge/finalization-preview`
- `POST /api/admin/strava-challenge/finalize` with exact confirmation text
- `GET /api/admin/strava-challenge/email-preview`

Every private route rechecks server-side authorization. Dynamic fields and IDs are
bounded. Callback/invite responses set `Referrer-Policy: no-referrer`; request logs
redact OAuth codes/states and sensitive token-like query/path values.

### Public and admin UI

- Replace only the homepage clock area with one distinctive arena-jumbotron
  scoreboard. Keep Yannick left/red and Emma right/blue in every state. Use a
  three-track responsive score layout, tabular Geist Mono numerals, a restrained
  center-ice/period-board signature, and shared glass tokens.
- Prioritize identity, season score, this-week score, state/tiebreaker copy, feed,
  history, then secondary stats. Feed includes qualifying and shortfall reasons.
- Past-week buttons open an in-component detail view with a clear return to current
  week, final score/time/method/season-after, both activity lists, and category
  stats. A `?week=` deep link opens the requested finalized week.
- The page becomes vertically scrollable, preserves fixed nav/tool safe areas,
  and never scrolls horizontally at 320px. Public rendering is independent of
  `Auth.onReady` and cached-data/API failures do not break other homepage widgets.
- Extend the existing Yannick-only admin app with challenge configuration,
  participant/invite/connection/sync status, send/regenerate/reconnect actions,
  sync controls, finalization preview/confirmed manual action, and sandboxed email
  previews. Raw secrets are never shown; generated test links are returned once.
- `/strava-connect/` is a focused mobile-friendly consent/connection page.

## Ownership — disjoint write scopes

- Domain implementer: `lib/strava-challenge/domain.js`,
  `lib/strava-challenge/time.js`, `lib/strava-challenge/emails.js`, and their
  focused tests only.
- Service implementer: `lib/strava-challenge/store.js`, `crypto.js`,
  `strava-client.js`, `service.js`, `index.js`, and service/client tests only.
- Server implementer: `server.js`, `lib/assignment-coach.js`,
  `server.env.example`, plus route/logging tests only. Integrate against the
  documented service API without editing service-owned files.
- Public UI implementer: `apps/index.html`, `apps/strava-challenge.css`,
  `apps/strava-challenge.js`, and public UI tests only.
- Admin/connect UI implementer: `apps/admin/index.html`,
  `apps/strava-connect/index.html`, and their UI tests only.
- Root: this plan, `README.md`, `CODEX_CONTEXT.md`, integration fixes, combined
  diff/security review, validation, selective staging, commit, and push.

All implementers must preserve concurrent/user edits, stay inside ownership, not
commit or push, and report changed paths plus checks actually run.

## Acceptance checks

1. Qualification boundaries pass exactly: 3.99/4.00/4.01km run; 2.99/3.00km
   swim; 1.99/2.00km walk; 19:59/20:00 gym; 29:59/30:00 paddle;
   59:59/60:00 climb.
2. Count wins, both duration-tiebreaker directions, and exact true tie pass;
   non-qualifiers never affect count or qualifying time.
3. Halifax week math passes Sunday/Monday and spring/fall DST boundaries.
4. Invitations are participant-bound, hashed, expiring, revocable, single-use;
   OAuth state is separate, expiring, one-time, and non-replayable.
5. Missing `activity:read_all`, cross-participant athlete reuse, bad callback
   state, and unconfigured encryption/client secrets fail safely.
6. Pagination, duplicate upsert, edit/delete reconciliation, token refresh, newest
   refresh-token persistence, retryable network/rate-limit errors, and cached public
   reads pass with mocked HTTP only.
7. Initial sync starts at configured challenge start and records completeness;
   regular sync does not refetch full history or run during homepage requests.
8. Finalization requires two successful final syncs, is idempotent under repeat or
   concurrent calls, awards at most one point, snapshots immutable details, and
   prevents duplicate emails.
9. Public DTO and HTML contain no email, access/refresh token, client secret,
   invite/state token/hash, OAuth material, or private config. Logs redact
   invite/OAuth material.
10. Unauthenticated/non-Yannick admin calls receive 401/403; public scoreboard and
    week details work without login.
11. Homepage shows all requested scoreboard/feed/current stats/season stats/history
    states; history navigation and deep linking work; failure/empty/stale states are
    useful; existing weather, Ask Emma, launcher, auth, and tools still work.
12. At 320px and desktop widths, Yannick/Emma remain opposed, red/blue never swap,
    scores stay legible, controls have touch targets/focus rings, reduced motion is
    respected, and there is no page-level horizontal scrolling.
13. Admin can configure both emails/year/start, send/regenerate invitations, see
    safe status, sync either/both, preview finalization/emails, and perform a guarded
    manual finalization without exposing secrets.
14. `node --check` passes for changed JavaScript, focused tests pass, then `npm test`
    passes. There is no repository lint/typecheck/build command.
15. Final diff contains no real secrets, production data, unrelated user work, or
    accidental dependency/build artifacts.

## Risks and rollback

- File storage has no database transaction: mitigate with a single-process mutation
  queue, deterministic keys, unique temp files, backup, and derived standings.
- PM2 may restart mid-operation: persist finalization/email phases and make every
  operation safely repeatable.
- Resend idempotency expires after 24 hours: persist `sending/sent/failed` status and
  never automatically resend an ambiguous old `sending` delivery.
- Strava rate limits or outage: retain cached public data, expose last-updated state,
  back off on 429, and never finalize after a failed required sync.
- Encryption-secret loss requires reconnecting accounts; document backup/rotation
  implications and never fall back to plaintext.
- Rollback is the eventual single feature commit plus preservation of the gitignored
  state backup. No live restart or deployment is performed directly in this task.

## Progress

- [x] Pull and inspect repository, homepage/clock, auth, storage, deployment,
      scheduling, email, design system, environment, tests, and dirty worktree.
- [x] Verify current official Strava/Resend integration requirements and receive
      confirmation of written Strava approval for public display/retention.
- [x] Write implementation specification and disjoint ownership plan.
- [x] Implement domain, service, server routes, public UI, admin/connect UI, tests,
      documentation, and configuration examples.
- [x] Review combined diff and run security/acceptance testing.
- [x] Fix review findings and run full validation.
- [ ] Selectively stage only feature changes, commit, and push `main`.

## Active Repair — Strava OAuth Runtime Configuration

### Goal and evidence

Complete the existing Strava connection flow reliably. Live redacted PM2 logs on
2026-08-30 show that Strava returned an authorization code and the requested
`read,activity:read_all` scope, but token persistence failed because the running
process did not have `STRAVA_CHALLENGE_CRYPTO_SECRET`. The gitignored
`server.env` contains a valid-length secret and the documented callback URL.

### Proposed change and ownership

- The implementer owns `lib/strava-challenge/crypto.js`,
  `lib/strava-challenge/service.js`, and focused Strava tests only.
- Add a side-effect-free secure-storage configuration check and require it while
  preparing OAuth, before returning a Strava authorization URL.
- Preserve the callback encryption, participant binding, single-use state,
  scope checks, duplicate-athlete protection, and secret-safe responses/logs.
- Root owns combined diff/security review, the live-state backup, operational
  environment reload, browser verification, commit, and push.

### Acceptance, risk, and rollback

- Configured OAuth preparation and completion work with encrypted credentials.
- A missing or too-short encryption secret fails before the user leaves for
  Strava; no secret or OAuth credential appears in a response or log.
- Existing success, missing-scope, expired/replayed-state, and duplicate-athlete
  tests remain passing; focused Strava tests and `npm test` pass.
- Back up `data/strava-challenge/` before reloading PM2. Do not edit live state.
  Rollback is the repair commit plus the untouched timestamped state backup.

### Progress

- [x] Reproduce through redacted live logs and isolate the missing runtime secret.
- [x] Confirm callback URL, base URL, scope return, and secret-file presence.
- [x] Implement and review preflight validation with regression coverage.
- [x] Back up live Strava state before any operational reload.
- [x] Fix the canonical PM2 startup path so existing `apps-server` restarts
      reload `ecosystem.config.cjs` and the gitignored `server.env`.
- [x] Reload the configured PM2 environment through the elevated startup task.
- [x] Verify local/public, public/admin-auth, Strava preflight, MCP, and Cloudflare
      paths after restart.
- [ ] Complete a fresh browser OAuth approval/callback pass.
- [x] Run full validation, selectively commit only repair files, and push `main`.

## Active Rule and Recap Update

### Goal and ownership

- Count walks at 2,000 metres and gym/workout/weight activities at 1,200 seconds,
  preserving every other qualification and scoring rule.
- Re-evaluate active/unfinalized stored activities against the current rules at
  read/calculation time so old normalized flags cannot delay the rule change;
  finalized official snapshots remain immutable.
- Domain implementer owns `lib/strava-challenge/domain.js`,
  `test/strava-domain.test.js`, and Strava rule copy in `README.md`.
- UI implementer owns `apps/strava-challenge.js`,
  `apps/strava-challenge.css`, and `test/strava-public-ui.test.js`.
- Root owns this plan, combined diff review, validation, selective commit/push,
  and any separately authorized live restart.

### Recap design and acceptance

- Compact athlete recaps contain qualifying activities only, newest first.
- Show five initially, then an independent accessible `+N more` control per
  athlete with a way back to the latest five.
- Use semantic bullet lists in fixed Yannick red / Emma blue; remove green checks,
  red Xs, and qualification badges from the compact recap.
- Boundary tests cover 1,999/2,000m walks and 1,199/1,200s gym while proving the
  paddle threshold remains 1,800s. Focused and full suites must pass.
- A stale current-week qualification flag is refreshed in public score/activity
  output without mutating state; finalized week details remain stored as-is.

### Progress

- [x] Inspect thresholds, normalization, public DTO, recap rendering, and tests.
- [x] Write implementation specification and disjoint ownership plan.
- [x] Implement domain/rule-copy and recap/UI packages.
- [x] Review combined diff and run independent acceptance checks.
- [x] Selectively commit/push, restart through the elevated production task, and
      verify rules, recap assets, authentication, MCP, and Cloudflare publicly.

## Active Manual Strava Refresh

### Goal, constraints, and design

- Keep the automatic Strava synchronization interval at the persisted 30-minute
  setting; do not change the scheduler configuration.
- Add one homepage action that synchronizes both fixed challenge participants and
  refreshes the cached scoreboard for the signed-in `yannick` and `fishyemma`
  accounts only. Username comparison is case-insensitive and exact after
  normalization.
- Enforce authorization on the server, return only a safe summary, coalesce an
  already-running refresh, and apply a shared five-minute server-side cooldown
  so UI mistakes or repeated requests cannot unnecessarily consume the Strava
  API allowance.
- Treat the control as a quiet rink-side maintenance action: use the established
  glass scoreboard, shared typography/color tokens, a 44px touch target, clear
  focus, and an accessible status message. Do not add a new visual language.
- Keep the compact latest-five preview strictly qualifying-only, give each card a
  subtle athlete-tinted background, and use plain activity names/metrics without
  checkmarks, X markers, or qualification badges.
- Keep the manual refresh affordance compact: a text-only `Sync` action inline
  beside the latest-updated timestamp, not a standalone panel.

### Ownership and approach

- Backend implementer owns `server.js` and `test/strava-server-wiring.test.js`.
  Add a narrowly scoped authenticated refresh route, an allowlist helper, and
  in-flight/cooldown behavior around the existing `syncAll()` service method.
- Frontend implementer owns `apps/index.html`, `apps/strava-challenge.js`,
  `apps/strava-challenge.css`, and `test/strava-public-ui.test.js`. Register with
  `Auth.onReady`, render the control only for the two allowed accounts, attach the
  bearer token, disable while running, reload the public DTO after success, and
  show useful success/cooldown/error feedback.
- Root owns this plan, documentation/context decisions, combined diff and security
  review, independent acceptance, selective staging, commit/push, live restart,
  and post-deployment checks. Implementers must preserve concurrent/user edits,
  stay within ownership, not commit or push, and report changed paths and checks.

### Acceptance and rollback

- The persisted live interval remains exactly 30 minutes.
- The refresh route returns 401 without a valid session and 403 for any account
  other than normalized `yannick` or `fishyemma`; both allowed accounts can invoke
  one sync of both challenge participant slots.
- Concurrent/repeated refreshes do not create duplicate bursts of Strava calls;
  credentials, tokens, participant emails, and private configuration never appear
  in frontend assets, responses, or logs.
- The button is absent for signed-out/unrelated users and has working busy,
  success, cooldown, and error states for allowed users on desktop and mobile.
- Focused Strava tests and `npm test` pass. Rollback is the feature commit; no data
  migration is required, and the cached challenge state is backed up before the
  live restart.

### Progress

- [x] Confirm the live interval is already 30 minutes and identify `fishyemma` as
      the exact account username.
- [x] Write implementation specification and disjoint ownership plan.
- [x] Implement backend and frontend packages.
- [x] Review the combined diff and run independent security/acceptance checks.
- [x] Commit, push, restart the affected app process, and verify live behavior.

---

# Apple App Factory (DEEP) — active plan

## Goal

Add a durable, private-by-default factory for native Swift/SwiftUI iPhone and Apple Watch projects. It must create deterministic unsigned build artifacts on GitHub-hosted macOS, retain the full target bundle, publish only after integrity checks, and give future Codex sessions an explicit operating contract. Apple credentials, signed IPAs, and live deployment destinations remain outside Git.

## Existing behavior and constraints

- `server.js` is a plain Node static/API server; `apps/` is public static content and `data/` is ignored production state.
- The existing `ios/big-tuna-lights-widget` project is XcodeGen-based and has an iPhone app plus WidgetKit extension, but no Watch target or CI build.
- GitHub macOS workflows package existing unsigned desktop applications. The Windows host auto-pulls `main` and restarts `apps-server`; it has no configured inbound CI deployment credential.
- The working tree contains unrelated user-owned modifications/untracked files. This work must not replace or clean them.
- A free Apple Personal Team is for own-device testing only: seven-day profile, three installed apps/device, three devices, ten App IDs. It cannot provide App Store/TestFlight/ad-hoc distribution or cloud-held signing credentials.

## Scope and ownership

1. **Factory documentation and policy (implementer A):** `docs/APPLE_*.md`, `ios/app-factory/README.md`, `ios/app-factory/specs/APP_SPEC_TEMPLATE.yml`, release-note template, root-agent section and README section only. Document verified limitations, human steps, capability gates, and future-session rules.
2. **Native template and local tooling (implementer B):** `ios/app-factory/template/**`, `ios/app-factory/tools/**`, `ios/app-factory/.env.example`, and focused tooling tests only. Provide deterministic XcodeGen project generation, target toggles, config validation, versioning, IPA/archive inspection, checksums, release records, and a minimal PowerShell Sideloadly launcher that deliberately stops before a GUI-only action.
3. **CI and private distribution surface (implementer C):** `.github/workflows/apple-app-factory.yml`, `apps/apple-apps/**`, `scripts/apple-app-factory/**`, `server.js`, `server.env.example`, and `.gitignore` only. Build unsigned artifacts, validate/release them with immutable paths, and serve an authenticated owner-only catalogue/download flow from a configurable non-public release root. No deployment is executed.

## Architecture

- App specifications live in Git under `ios/app-factory/specs/<slug>.yml`; identity and target selection are immutable after first release except through explicit migration records.
- A generator creates XcodeGen input from a specification; build CI runs XcodeGen, Swift checks/tests, unsigned archive, IPA/extension inspection, SHA-256, and produces artifacts/logs. It can upload to a server only when narrowly scoped SSH secrets are deliberately supplied; without them it preserves GitHub artifacts and does not change `latest`.
- The home server reads artifacts from its ignored `data/apple-app-factory/releases` root. Owner-authenticated API endpoints expose the catalogue and a browser download route only to the account configured in environment, so no release content becomes public by accident. Static `apps/apple-apps/` is UI code only.
- The web UI makes clear that Safari cannot install a free-signed IPA directly. It offers verified downloads and optionally source metadata only after a compatible installer has been physically validated with the requested Watch bundle.
- Capabilities are selected explicitly per spec and the build fails rather than silently dropping unsupported extensions/entitlements. Free-provisioning compatibility is documented as a gate, not assumed from a successful unsigned build.

## Risks and rollback

- Apple/installer limitations can prevent signed installation of widgets or Watch components despite a structurally correct IPA. No claim of support is made until physical acceptance testing.
- SSH deployment is disabled by default; server release-root configuration, inbound auth, and any CI secret must be supplied by the owner. Failed builds/uploads must never overwrite an existing `latest` release.
- Server route changes are owner-authenticated and constrained to validated slugs/files below one release root. Rollback is removal of this change; existing app/API/data behavior is unaffected.

## Acceptance checks

- Validate every sample/spec/workflow/JSON configuration with the provided scripts and parser checks.
- Run tooling help/validation/version/checksum routines on the local Windows host without Apple credentials.
- Run relevant Node tests and syntax checks; exercise the release catalogue API in a non-mutating test harness where feasible.
- Inspect the generated target graph and archive inspection logic to confirm iPhone, widget, and optional Watch bundle paths are checked—not stripped.
- Review actual combined diff for secrets, accidental public access, unsafe paths, and unrelated files. Independently security-review release routes and SSH deployment configuration.
- Do not claim a GitHub macOS build, device install, Watch install, signing refresh, or server upload passed until that external action is actually run with user-provided access/device.

## Progress

- [x] Inventory repository, current status, service/deployment flow, and existing iOS project.
- [x] Verify current Apple Personal Team limits and installer documentation from primary sources.
- [x] Implement disjoint documentation, template/tooling, and CI/distribution packages.
- [x] Run local validation and independent security/acceptance review.
- [x] Root review and corrective loop complete. Commit/push deliberately withheld: this live auto-pull repository has unrelated pre-existing work and the private deployment receiver/credentials are intentionally not configured.

## Active Extension — BIG TUNA Lights native Apple family

### Goal and mode

Implement the existing BIG TUNA Lights native project end to end in DEEP mode while preserving its released identity and every existing website, HomeKit, scheduler, and ESP client. Deliver a native iPhone switch matching the Lights page, a small interactive Home Screen widget, an iPhone Control Center toggle, a companion Watch app, Watch complication/Smart Stack widget, and a watchOS 26 control for Control Center, Smart Stack, and Apple Watch Ultra Action button placement.

Apple does not expose an app-icon-sized 1x1 Home Screen WidgetKit family. The requested 1x1 surface is therefore the system control; the Home Screen surface is `.systemSmall`, the square size occupying the familiar small-widget footprint. The implementation must not claim a physical install, Watch delivery, or seven-day refresh result until those checks are run on the owner's devices.

### Stable identity and compatibility constraints

- Preserve iPhone bundle ID `ca.yannickmorgans.bigtuna.lights`, widget/control extension ID `ca.yannickmorgans.bigtuna.lights.widget`, and App Group `group.ca.yannickmorgans.bigtuna.lights`.
- Add deterministic Watch IDs `ca.yannickmorgans.bigtuna.lights.watchapp` and nested extension ID `ca.yannickmorgans.bigtuna.lights.watchapp.widget`; record all IDs and observed Personal Team consumption in the durable factory spec.
- Keep `GET/POST /api/lights`, `/api/lights/events`, `/api/lights/device`, `/api/lights/device/status`, HomeKit state propagation, inverted stored-state semantics, and scheduled changes compatible.
- Native surfaces operate on explicit physical light state. Inversion is centralized in one server/native boundary and is covered by tests.
- Existing untracked `server.env.backup-*` files are user-owned and must remain untouched and uncommitted.

### Architecture and data contract

- Add an owner-only versioned native endpoint that returns physical desired state, last physical reported state when known, relay recency, revision/update time, and safe availability metadata.
- Mutations accept an explicit physical target plus a bounded unique command ID. The server serializes updates and journals recent command results so network retries remain idempotent across restarts and cannot double-cycle the relay.
- Exchange the temporary website login for a revocable Lights-only bearer token; never place passwords or full-site sessions in extensions or Watch storage. Share only the scoped token through the existing App Group, transfer it to the paired Watch through WatchConnectivity, and clear it everywhere on logout/401. No Apple credential or signing material enters Git, CI, or the server.
- The iPhone app uses native SwiftUI, not a WebView. Its signature visual is the physical wall plate/paddle: dark raised room when off, warm cone/plate when on, upper screw for verified control access, lower screw for recent relay heartbeat. Motion is limited to the paddle and ambient transition and respects reduced-motion settings.
- Widget/control intents never foreground the app. They fetch authoritative state, submit an idempotent explicit target, persist only confirmed results, and reload widget/control state. Cached state is labeled unavailable/stale on failure rather than displayed as a confirmed command.
- The Watch app is a companion target with direct HTTPS control when network is available and WatchConnectivity for credential/current-state transfer. The complication is glanceable status/launcher; the watchOS control is the guaranteed no-open action surface.

### Disjoint implementation ownership

- Server implementer owns `lib/lights-native-control.js`, `server.js`, and new focused native-lights route/domain tests only.
- Factory implementer owns `ios/app-factory/tools/**`, the spec schema/template, relevant generic factory template files, and `test/apple-app-factory-tools.test.js`; add explicit iPhone/watch control declarations and archive evidence without product UI work.
- iPhone implementer owns `ios/big-tuna-lights-widget/BigTunaLights/**`, `BigTunaLightsWidget/**`, `Shared/**`, `project.yml`, and that app's README; implement iPhone app/widget/control and shared client/state.
- Watch implementer owns new `ios/big-tuna-lights-widget/BigTunaLightsWatch/**` and `BigTunaLightsWatchWidget/**` paths only; implement Watch app, connectivity receiver, widget/complications, and control against the shared contract.
- Root owns this plan, durable app spec, CI/workflow integration, documentation/context updates, combined diff and security review, integration fixes, final validation, commit, and push. Implementers must preserve concurrent/user edits, stay within ownership, not commit or push, and report changed paths and checks.

### Acceptance checks

1. Existing website, schedule, HomeKit, SSE, and device route tests remain green and their payload contracts do not change.
2. Native read maps stored inversion correctly and reports desired, reported, heartbeat, revision, and timestamp without leaking secrets.
3. Native mutation returns 401/403 appropriately, rejects malformed/oversized IDs and bodies, is idempotent under repeated command IDs, and produces one relay transition under concurrent/retried requests.
4. App sign-in verifies the owner, logout/401 clears extension and Watch access, and no password or Apple/signing secret is persisted or committed.
5. iPhone app renders and controls on/off, signed-out, offline, pending, stale, and relay-offline states with VoiceOver labels, useful errors, and reduced motion.
6. `.systemSmall` widget and iPhone control show confirmed status and toggle through App Intents with `openAppWhenRun=false`.
7. Watch app, accessory widget families, complication, and watchOS control are present in the generated target graph and use the same physical-state contract; Control Center/Smart Stack/Action-button availability is gated to watchOS 26.
8. Factory validation rejects missing control IDs/targets, deterministic generation includes every enabled component, and archive inspection fails when any requested iPhone/Watch extension is absent.
9. Run JavaScript syntax checks, focused lights/factory tests, generated-project validation, full `npm test`, secret scan, `git diff`, and `git status`. Run macOS compilation through the configured GitHub workflow when available; do not claim simulator/device success from Windows structural checks.
10. Physical release gate records iOS/watchOS, installer version, archive contents, actual App ID use, sign date/expiry, iPhone app/widget/control behavior, Watch installation/app/complication/widget/control behavior, offline/reconnect, restart persistence, and day-5-to-7 refresh behavior.

### Risks and rollback

- Free Personal Team profiles expire after seven days and multi-bundle Watch installation remains unverified. Keep all surfaces declared and fail the release rather than stripping a target.
- Widget timelines are opportunistic without APNs. Interactions refresh immediately; external state may display the last confirmed value until WidgetKit permits another refresh.
- App Group access may fail provisioning. Validate the profile and never weaken storage silently; the shared credential is limited to Lights and is revoked on logout/401.
- Rollback is the single feature commit. The server API addition is additive, existing device and website routes remain available, and no live data migration or deployment restart is required by the code change itself.

### Progress

- [x] Read Apple factory/signing/capability/installation/distribution/troubleshooting guidance and current Apple platform documentation.
- [x] Inspect the Lights page, server routes, existing native app/widget, factory generator/inspector, and relevant tests.
- [x] Write implementation specification and disjoint ownership plan.
- [x] Implement server, factory, iPhone, and Watch packages.
- [x] Review combined diff and run independent security/acceptance testing.
- [x] Correct findings and complete full validation.
- [x] Commit and push `main`; do not restart or otherwise deploy the live server without separate explicit authorization.

## Active Extension — Sideloadly widget/control discovery repair

### Goal and diagnosis

Produce BIG TUNA Lights 1.1.1 (3) as a transient Sideloadly-prepared artifact so
the installed iPhone app is discoverable in both the Home Screen widget gallery
and Control Center. The current 1.1.0 IPA contains the WidgetKit extension and
App Intents metadata, but it predates the workflow support that prepares nested
bundle identifiers for the host identifier Sideloadly derives while signing.

### Scope, constraints, and ownership

- Preserve every canonical bundle identifier, the App Group, storage schema,
  server API, source targets, and Watch components.
- Never commit the locally observed Personal Team suffix, certificate, key,
  session, provisioning profile, device identifier, or other signing material.
- Never promote the noncanonical Sideloadly-prepared artifact as `latest`; it is
  an owner-controlled installation input only.
- The implementer owns only the durable app spec, product `project.yml`, and a
  new 1.1.1 release-notes file. Root owns this plan, diff review, workflow
  dispatch/download, artifact inspection, Git integration, and local handoff.
- No website restart or live server deployment is authorized or required.

### Approach and acceptance checks

1. Bump the durable spec and XcodeGen project together to 1.1.1 build 3, with
   release notes explaining the Sideloadly widget/control discovery repair.
2. Validate the app spec and version/build alignment, run focused factory tests,
   then run the full Node regression suite.
3. Commit and push the reviewed source change, then dispatch the macOS Apple App
   Factory workflow with the locally detected suffix supplied only as a transient
   workflow input.
4. Require a successful unsigned compile/archive and component inspection.
   Download the resulting artifact and independently verify its checksum,
   complete nested target tree, rewritten embedded IDs and Watch companion
   pointer, WidgetKit extension metadata, and App Intents metadata.
5. Select the verified IPA in File Explorer and open Sideloadly for the user's
   final Apple Account, 2FA, device, and Start actions. Physical widget/control
   success remains unverified until the user installs and checks the device.

### Progress

- [x] Read required Apple guidance, app spec, current release records, and source.
- [x] Confirm the current IPA contains the expected extension and identify the
      host/embedded identifier mismatch addressed by the newer workflow.
- [x] Write implementation specification and isolated ownership package.
- [x] Implement and review the versioned release change.
- [x] Run local validation and independent acceptance review.
- [x] Build, inspect, download, and open the prepared artifact.
- [x] Commit and push; do not deploy or restart the website.

## Active Extension — iPhone-only widget/control release

### Goal and observed failure

Replace the rejected Watch-bearing 1.1.1 handoff with BIG TUNA Lights 1.1.2
(4), containing only the iPhone host and its iOS WidgetKit extension. Sideloadly
reported an invalid companion-app bundle identifier; the user explicitly chose
to remove Watch delivery and retain only the iPhone Home Screen widget and
Control Center control.

### Scope, constraints, and ownership

- Keep the canonical iPhone ID, iOS widget/control extension ID, App Group,
  storage schema, authentication flow, and Lights API unchanged.
- Disable every Watch target and WatchConnectivity toggle in the active spec.
  Preserve the previously released Watch IDs as retired identity metadata so
  they cannot be reassigned accidentally.
- Keep dormant Watch sources in Git for rollback, but do not compile or embed
  them. The shipped Xcode target graph must contain only `App` and `AppWidget`.
- Product/release implementer owns the durable spec, `project.yml`, product
  README, 1.1.2 release notes, and focused factory-test assertions. iPhone-code
  implementer owns only the iPhone/widget/shared Swift call sites that currently
  invoke WatchConnectivity. Root owns this plan, context update, integration,
  diff review, workflow dispatch/download, artifact inspection, commits, pushes,
  and Explorer handoff.
- Never commit or print signing credentials, the locally observed Team suffix,
  certificates, profiles, keys, sessions, or device identifiers. The prepared
  artifact remains noncanonical and cannot deploy as `latest`.

### Approach and acceptance checks

1. Bump the spec/project to 1.1.2 build 4; select iPhone, Home Screen widget,
   and iPhone control only; null active Watch bundle slots while recording their
   stable retired identities.
2. Remove Watch targets/dependencies from `project.yml`, remove iPhone/widget
   WatchConnectivity calls, and ensure the dormant bridge is excluded from the
   two active targets.
3. Validate the spec and generated evidence: exactly two Xcode targets, one
   iOS extension used for both widget and control, no Watch target evidence.
4. Run focused factory checks and the complete Node regression suite; review
   the combined diff and run an independent acceptance pass.
5. Commit/push, run the macOS factory with transient Sideloadly preparation,
   and require compilation plus archive inspection to pass.
6. Download and verify SHA-256, binary plist identities, extension containment,
   WidgetKit and App Intents metadata, exactly one `.appex`, and no `Watch/`
   payload. Open the verified 1.1.2 IPA in Explorer.
7. Do not claim physical success until Sideloadly installs it and the iPhone
   widget gallery and Control Center both show BIG TUNA Lights.

### Progress

- [x] Reproduce the failure from the user's exact Sideloadly error and identify
      the embedded companion Watch bundle as the rejected component.
- [x] Write the iPhone-only implementation specification and disjoint ownership.
- [x] Implement and review the target/source changes.
- [x] Run local and independent acceptance checks.
- [x] Build and inspect the exact iPhone-only IPA.
- [x] Open the verified artifact, commit, and push without server restart.

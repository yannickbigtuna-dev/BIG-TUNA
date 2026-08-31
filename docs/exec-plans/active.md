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

# Active Execution Plan

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

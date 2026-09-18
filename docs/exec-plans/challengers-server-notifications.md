# CHALLENGERS server-owned scheduled notifications (2026-09-18)

## Goal and mode

DEEP notification and live-deployment change. Deliver the existing 9:00 AM,
1:00 PM, and 8:00 PM CHALLENGERS notification cadence through server-side APNs
even when the app is suspended, terminated, or has not recently been opened.

## Existing behavior

- The iOS app registers an APNs token and deliberately cancels score-bearing
  local daily requests after dashboard reads.
- Event pushes and admin-created scheduled pushes already originate on the
  server.
- The replacement timed score scheduler described in `NOTIFICATIONS.md` was
  never enabled, so opening the app was still the only time the local evaluator
  ran.

## Proposed changes

- Add a server-owned Halifax-time scheduler for morning, midday, and night.
- Refresh authoritative Strava/challenge data immediately before selecting a
  category and rendering recipient-specific copy.
- Persist a bounded per-recipient slot ledger so restarts and repeated ticks do
  not duplicate delivery.
- Treat expired slots as skipped. Never replay several missed notifications
  when the server restarts or a user opens the app.
- Deliver through the existing encrypted device registry and APNs sender,
  disabling invalid tokens and recording redacted outcomes.
- Keep the app responsible only for permission, token registration, display,
  navigation, and explicit test notifications.

## Constraints and rollback

- Preserve bundle IDs, entitlements, account/session contracts, review/custom
  notifications, scoring rules, and encrypted token storage.
- Do not log or serialize raw APNs tokens or deployment credentials.
- Back up live state before restart. Startup validates and atomically folds the
  accidentally nested challenge-account namespace into the canonical namespace;
  conflicting duplicate IDs fail closed instead of being overwritten.
- Roll back code and restore the pre-migration state backup together. The iOS
  rollback is separate if app documentation or safeguards change.

## Acceptance checks

1. A due slot sends without any app request or foreground activity.
2. Repeated ticks and process restarts send a recipient/slot at most once.
3. A tick after the delivery window marks/skips the slot without sending, and
   later app activity cannot replay it.
4. Halifax date/time and DST boundaries select the correct slot and category.
5. Authoritative refresh occurs before score/category rendering.
6. APNs unavailable, transient failure, and invalid-token paths remain safe and
   do not create a retry or catch-up storm.
7. Existing event, review, custom-notification, challenge, and full server tests
   remain green; iOS CI confirms the native project still builds.

## Progress

- [x] Trace current app-local cancellation and existing server APNs paths.
- [x] Implement server scheduler, durable ledger, rendering, and tests.
- [x] Update notification/API/operational documentation.
- [ ] Review diffs, run focused and full validation, commit, push, deploy, and
      verify live scheduler/APNs status.

> Coordination note: `docs/exec-plans/active.md` contains a pre-existing
> unfinished Lamp deployment extension, so this independent plan is kept in a
> separate file rather than overwriting that user-owned work.

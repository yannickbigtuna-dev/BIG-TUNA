# AURA backend — implementation spec (2026-10-15)

AURA is a private two-person iPhone app (repo `yannickbigtuna-dev/AURA`,
workspace `~/BigTuna/APPS/AURA`). This spec adds its backend to BIG TUNA.
Native contract mirror: `~/BigTuna/APPS/AURA/docs/API.md` (this spec wins on
conflict; root will sync the app doc).

## Identity constants
- Bundle IDs: app `ca.yannickmorgans.aura`, widgets `ca.yannickmorgans.aura.widgets`,
  NSE `ca.yannickmorgans.aura.notificationservice`. Team `P2YVULJ374`.
- API prefix `/api/aura/v1`. Invite URL `https://yannickmorgans.ca/aura/invite#token=<token>`.
- Data root `path.join(DATA, 'aura')` (never committed).

## Files / ownership (backend implementer)
- NEW `lib/aura.js` — `createAura({ dataDir, getSessionUser, readUsers, apns, now, logger })`
  returning `{ handle(req, res, urlPath) -> Promise<boolean>, startScheduler(), stopScheduler() }`.
  Pure Node stdlib. Must not depend on server.js internals beyond injected functions.
- NEW `lib/aura-apns.js` — generalized APNs sender (see APNs). May reuse/copy logic
  from `lib/challenge-apns.js` but MUST NOT modify challenge-apns.js behavior.
- EDIT `server.js` — minimal wiring only: require, construct with injected deps,
  call `if (urlPath.startsWith('/api/aura/v1/') && await aura.handle(req,res,urlPath)) return;`
  near the top of `handleAPI` (before broad dynamic routes), start scheduler next to
  `challengeNotificationScheduler.start()`, add AURA to the AASA payload, serve
  `/aura/invite` → `apps/aura-invite/index.html`.
- NEW `apps/aura-invite/index.html` — fallback landing page (see Web).
- NEW `test/aura.test.js` (+ `test/aura-apns.test.js`) using `node:test`, temp data dirs,
  fake apns. Run with `node --test test/aura*.test.js`.
- Do NOT touch other apps, live `data/`, `server.env`, or restart PM2. Do not commit.

## Auth
Bearer token via injected `getSessionUser(token)` (returns user `{id, username}` or null).
Token from `Authorization: Bearer`. 401 `{error}` when missing/invalid, except public routes.
All responses: JSON, `Cache-Control: no-store`, errors `{error: "..."}` — never stack traces.
All ids used in paths validated `^[A-Za-z0-9_-]{1,64}$`.

## Storage (atomic writes: write `.tmp` then rename; mkdir -p lazily)
```
aura/users/<userId>.json   {id, displayName, avatarVersion, pairId|null, devices:[{id, channel, environment, tokenEnc, updatedAt}], widgets:{list:[], reportedAt}}
aura/pairs/<pairId>.json   {id, members:[uidA, uidB], createdAt}
aura/invites.json          {byHash: {<sha256 hex>: {fromUserId, createdAt, expiresAt, usedAt|null}}}
aura/counters/<userId>.json [Counter]
aura/inbox/<recipientId>/<kind>-<size>.bin + <kind>-<size>.json (CanvasMeta + contentType)
aura/notes/<pairId>.json   [ScheduledNote + fromUserId + toUserId] (keep newest 200)
aura/note-images/<pairId>/<imageId>.jpg
aura/avatars/<userId>.jpg
```
Default displayName = BIG TUNA username. Serialize mutations per process with a
simple promise-chain mutex so concurrent accepts can't double-pair.

## Routes (all under /api/aura/v1)
Profile = `{id, displayName, avatarVersion}` (avatarVersion int, 0 = none).

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | `{user: Profile, partner: Profile|null, pairedAt: iso|null}` |
| PUT | `/profile` | `{displayName}` trimmed 1–40 chars → Profile |
| PUT | `/profile/avatar` | raw body image/jpeg or image/png ≤ 1 MB, magic-byte checked → Profile (avatarVersion++) |
| GET | `/avatar/:userId` | self or partner only, else 404; returns image bytes |
| POST | `/invites` | 409 `already_paired` if paired. Creates 32 random bytes base64url token; stores sha256 hash; revokes caller's earlier unused invites; expires 7 days → `{url, expiresAt}` |
| POST | `/invites/preview` | PUBLIC, rate limit 30/min per IP (`x-forwarded-for` first hop / `cf-connecting-ip` / remote). `{token}` → `{fromName, expiresAt}`; unknown/expired/used → 404 `{error:"Invitation is unavailable."}` |
| POST | `/invites/accept` | `{token}`. 404 if invalid/expired/used; 400 if accepting own invite; 409 if either party already paired. Creates pair, marks invite used → same body as `/me` |
| DELETE | `/pair` | Unpair: clear pairId on both users, delete pair file, both inboxes, notes file, note-images dir. → `{}` |
| POST | `/devices` | `{token: hex 64–200, channel: "app"|"widgets", environment: "sandbox"|"production"}` upsert by (channel, token digest); max 10 devices per user (drop oldest) → `{}` |
| GET | `/counters` | caller's counters |
| PUT | `/counters/:id` | Counter `{id,name(1–60),date,mode:"until"|"since",emoji(≤16 chars),createdAt}`; path id must equal body id; max 100 → Counter |
| DELETE | `/counters/:id` | → `{}` |
| GET | `/partner/counters` | requires pair, else 409 `not_paired` |
| PUT | `/widgets` | `{widgets:[{kind(≤64),family(≤32),counterId?,style?}]}` ≤ 50 → `{}` |
| GET | `/partner/widgets` | `{widgets, reportedAt}` (empty list if none) |
| PUT | `/canvas/:kind?size=small|medium|large` | kind doodle|photo; raw PNG/JPEG ≤ 2 MB (magic bytes); requires pair; writes to partner inbox, version = prev+1 → CanvasMeta. Then push (see below). Rate limit 30/hour per user (429) |
| GET | `/inbox/:kind` | `[CanvasMeta]` for caller (one per size present) |
| GET | `/inbox/:kind/image?size=` | bytes with stored content-type; 404 if none |
| POST | `/notes/images` | raw JPEG ≤ 1 MB, requires pair → `{imageId}` (random 16 bytes hex) |
| GET | `/notes/images/:imageId` | pair members only |
| POST | `/notes` | NoteDraft (below). Requires pair. title≤100, subtitle≤100, body≤1000, at least one of title/body non-empty. If `sendAt` null or ≤ now+5s → deliver immediately, status `sent` (or `failed` if every push failed / no devices: still 201 with status). Else `scheduled` (sendAt ≤ 1 year ahead). Rate limit 60/hour. → 201 ScheduledNote |
| GET | `/notes` | notes sent by caller, newest first, max 100 |
| DELETE | `/notes/:id` | only sender, only while scheduled → status `cancelled`, `{}` |

CanvasMeta = `{kind, size, version, sentAt, fromName}`.
NoteDraft = `{title, subtitle, body, imageId?, sound: "standard"|"none"|"chime"|"heartbeat"|"kiss", interruption: "passive"|"active"|"timeSensitive", badge?: int 0–99, sendAt?: iso}`.
ScheduledNote = `{id, draft: NoteDraft, status: "scheduled"|"sent"|"failed"|"cancelled", createdAt}`.
Dates are ISO-8601 strings (Swift `.iso8601` decoding: no fractional seconds! Use
`new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')`). Accept incoming dates with or without ms.

Raw-body reads: bounded stream reader rejecting > limit with 413 while draining.

## Pushes (lib/aura-apns.js)
`createAuraApns({ env, logger, connect, now })` → `{ configured, send({token, environment, pushType, topic, priority, payload}) }`.
- Credentials: `APNS_TEAM_ID` + `APNS_KEY_ID`/`APNS_AUTH_KEY_BASE64` with the same
  `APNS_PRODUCTION_*`/`APNS_SANDBOX_*` override semantics as challenge-apns.
  (One APNs .p8 key works for every bundle on the team.)
- App topic `AURA_APNS_BUNDLE_ID || 'ca.yannickmorgans.aura'`.
- Same JWT caching, wrong-environment retry, and 410/Unregistered → `invalid_token` result.
- Device token encryption at rest: AES-256-GCM keyed from
  `AURA_DEVICE_TOKEN_CRYPTO_SECRET || CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET` (sha256 of secret).
  If neither present, store tokens refusing? → No: if no secret, respond 503 to POST /devices.
- Remove devices whose send returns `invalid_token`.

Canvas sent → for each partner device:
- channel `widgets`: pushType `widgets`, topic `<bundle>.push-type.widgets`, priority 10,
  payload `{"aps":{"content-changed":true}}`.
- channel `app`: pushType `background`, priority 5, topic `<bundle>`,
  payload `{"aps":{"content-available":1},"aura":{"kind":"<kind>"}}`.
Debounce: at most one widgets push per recipient per 5 s (later canvas within window
schedules one trailing push).

Note delivered → for each partner `app` device: pushType `alert`, priority 10 (5 if passive):
```json
{"aps":{"alert":{"title":"","subtitle":"","body":""},"sound":"default"|<name>.caf|omitted for none,
 "interruption-level":"passive"|"active"|"time-sensitive","badge":n?,"thread-id":"<pairId>",
 "mutable-content":1},"aura":{"noteId":"","imageId":""?}}
```
Empty title → use sender displayName.

## Scheduler
`startScheduler()` interval 20 s (unref'd): scan notes files, deliver due `scheduled`
notes (status → sent/failed, `deliveredAt`). Guard against overlap. Missed notes after
downtime are delivered on next tick if < 24 h late, else `failed`.

## AASA
Add to the AASA response a details entry
`{appIDs:[AURA_AASA_APPLICATION_ID || 'P2YVULJ374.ca.yannickmorgans.aura'], components:[{'/':'/aura/invite'},{'/':'/aura/invite/*'}]}`.
Existing Challengers entry must remain byte-identical when its env var is set; when it
is not set, the payload is still served with only the AURA entry (previously 404).

## Web fallback `apps/aura-invite/index.html` (served at `/aura/invite` and `/aura/invite/`)
Standalone page (no topbar/auth), light `#F7F9FC` bg, baby-blue `#89CFF0` accent,
system font, centered card: heart, "AURA", calls `/invites/preview` with the
fragment token, shows "<fromName> invited you", button "Open in AURA"
→ `aura://invite?token=…`. Error state "This invite expired". Token never sent
anywhere else; read from `location.hash` and validated `^[A-Za-z0-9_-]{20,128}$`.

## Acceptance (tests must cover)
1. Two users: A creates invite, B previews (no auth), B accepts → both `/me` show partner; reuse of token 404; A creating invite while paired 409; third user can't accept.
2. Counters CRUD + partner counters; validation errors 400.
3. Canvas PUT by A lands in B's inbox with version 1 then 2; A's own inbox empty; bad magic bytes 400; >2 MB 413; widgets + app pushes issued with correct headers to B's devices only.
4. Notes: immediate send produces alert payload with mapped interruption/sound; scheduled note delivered by scheduler tick when due; cancel works only for sender while scheduled.
5. Unpair deletes inboxes/notes; partner routes return 409 after.
6. Auth: no token 401 on every non-public route; path traversal ids rejected.
7. APNs: invalid_token removes device; environment fallback; topic/push-type headers.
8. Existing `node --test` suite still passes (run full suite at end).

# BIG TUNA server endpoint reference

**Executable source of truth:** [`server.js`](../server.js). This is the
complete HTTP endpoint inventory exposed by the main server on port 3000 as of
2026-09-08. It is written for application authors: it describes what a client
may call, not an authorization grant. `docs/API_CONTRACT.md` is the supported
native-client contract and `docs/openapi.yaml` is the machine-readable subset
for Yannick Lights; this reference includes the wider live surface.

Base URL is `https://yannickmorgans.ca` (`http://localhost:3000` locally).
JSON responses use `{ "error": "…" }` for failures unless noted. Every
path parameter labelled `id`, `appId`, or `slug` is validated; clients should
URL-encode paths and never infer another user's identifier.

## Access conventions

| Access | How to send it |
| --- | --- |
| Public | No credential. Public does not imply a route is appropriate for a new app. |
| Website session | `Authorization: Bearer <website-session>`. Session tokens are issued by login/register and expire after 30 days. |
| Owner | Website session for the account whose username is `yannick`. |
| Native Lights | A revocable Lights-only bearer token obtained from the owner-only native session exchange. |
| Relay | `X-Big-Tuna-Device-Token`, but only when the server has `LIGHTS_DEVICE_API_TOKEN` configured. |
| Member | Website session plus membership in the addressed shared list. |

Routes that use a `t` query parameter do so because the relevant browser API
cannot attach an Authorization header. Treat it as sensitive; do not log it or
place it in a link shared with anyone else.

## Identity and general per-user storage

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `POST /api/auth/register` | Public | `{username,password}` → website session `{token,username,id,email}`; validates username/password and returns `409` for a duplicate name. |
| `POST /api/auth/login` | Public | `{username,password}` → the same website session shape; `401` for invalid credentials. |
| `POST /api/auth/logout` | Public (token optional) | Removes the supplied session when present → `{ok:true}`. |
| `GET /api/auth/me` | Website session | Current sanitized `{username,id,email}`; `401` without a valid session. |
| `POST /api/auth/set-email` | Website session | `{email}` (empty clears it) → `{ok:true,email}`; validates email. |
| `POST /api/auth/forgot-password` | Public | `{username}` → always `{ok:true}`; may send a one-hour reset email without disclosing account existence. |
| `POST /api/auth/reset-password` | Public | `{token,password}` → `{ok:true}`; a valid token is single-use and invalidates every existing session. |
| `POST /api/account/test-email` | Owner | No body → `{ok:true}` after a diagnostic email, or configuration/delivery error. |
| `GET /api/settings/{appId}` | Website session | Read the caller's settings object for the validated app ID. |
| `POST /api/settings/{appId}` | Website session | JSON settings object/value → `{ok:true}`; writes only the caller's app settings. |
| `GET /api/data/{appId}` | Website session | Read the caller's app-data JSON for the validated app ID. |
| `POST /api/data/{appId}` | Website session | JSON app data → `{ok:true}`; writes only the caller's app-data JSON. |

## Lights, HomeKit, relay, and native clients

The public legacy state uses the stored `on` field. Native clients must use
`physicalOn` exclusively: the server intentionally contains the relay-output
inversion boundary. The native operation is idempotent by `commandId`; reuse
for the same target is safe and reuse for a different target returns `409`.

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `POST /api/lights/native/v1/session` | Owner website session | No body → `{token,username}` Lights-only token (30-day lifetime). |
| `DELETE /api/lights/native/v1/session` | Token optional | Revokes the supplied native bearer token → `{ok:true}` even if omitted. |
| `GET /api/lights/native/v1` | Native Lights | Authoritative physical desired state plus trusted relay status. |
| `PUT /api/lights/native/v1` | Native Lights | Only `{physicalOn:boolean,commandId}` → authoritative command result; `400`, `409`, or `413` for invalid body/conflict/oversize. |
| `GET /api/lights` | Public | Legacy desired `{on,updatedAt}`. |
| `POST /api/lights` | Public | Only `{on:boolean}` → updated `{on,updatedAt}`; `400` invalid JSON/shape, `413` oversized body. |
| `GET /api/lights/events` | Public SSE | See streaming section; starts with the current desired legacy state. |
| `GET /api/lights/homekit` | Owner | HomeKit availability and pairing info; returns an unavailable shape when the bridge is off. |
| `GET /api/lights/homekit/qr` | Owner | Unpaired HomeKit setup QR as SVG; `409` once pairing is unavailable and `503` without bridge. `Cache-Control: no-store`. |
| `GET /api/lights/device` | Relay | Relay-oriented desired `{on,updatedAt,pollAfterMs}`; `on` may be inverted by server configuration. |
| `GET /api/lights/device/status` | Public | Sanitized latest relay heartbeat/status. |
| `POST /api/lights/device/status` | Relay | Only `{on:boolean}` → `{ok:true,trusted}`. When a relay token is configured, it is required. |

## Authenticated challenge accounts

All routes in this section require a normal website bearer session:
`Authorization: Bearer <website-session>`. Responses set `Cache-Control:
no-store` and never contain a Strava access/refresh token, OAuth material,
raw device token, email address, or another account's private data. A website
session is also the native Challenge client's bearer credential: there is no
second account, challenge login, Strava credential record, or challenge data
store. Account Strava credentials and challenge records are server-side parts
of the existing Strava Challenge state. Challenge reads are membership-scoped,
so a non-member gets `404` rather than confirmation that a challenge exists.
Challenge reads are limited to 90/minute and writes to 30/minute per
authenticated account; excess requests receive `429`.

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `GET /api/challenge-accounts/me` | Website/native website session | Sanitized account profile and own Strava `{connected,lastSyncAt,athlete}` status; `401` without a session. |
| `POST /api/challenge-accounts/strava/connection/start` | Website/native website session | Optional `{redirectMode:"native"|"web"}` (defaults to `native`) → `{authorizationUrl,transactionId,expiresAt}`. The authorization URL is single-use and expires in 10 minutes (or the server's shorter configured value). |
| `GET /api/challenge-accounts/strava/connection` | Website/native website session | Current `{strava:{connected,athlete,lastSyncAt}}`; safe status/reconnect probe. |
| `DELETE /api/challenge-accounts/strava/connection` | Website/native website session | Removes this account's existing Strava connection → the same disconnected `strava` status. |
| `GET /api/challenges` | Website session | Lists only challenges containing the caller. |
| `POST /api/challenges` | Website session | Creates a challenge from `yannick-emma-default`, `weekly`, `season`, `distance`, `streak`, or `custom`; returns `201`, or `400` for invalid template/rules. The creator is always an owner. Supplying a valid `idempotencyKey` makes a retry return the original challenge instead of creating another. |
| `GET /api/challenges/{id}` | Participant | Detail with participants, rules, current/season score, activity/history/tiebreaker summaries, and pending-review count; `401`/`404`. |
| `DELETE /api/challenges/{id}` | Owner | Permanently removes the challenge, its activities, reviews, and related in-app events → `{deleted:true}`; `403` for admins/members. |
| `PUT /api/challenges/{id}/settings` | Owner or admin | Replaces validated rule settings/participants; `403` for a member, `400` invalid shape. |
| `POST /api/challenges/{id}/review-requests` | Participant | `{activityId,reason?}` creates a request for the caller's unqualified activity; `201`, `400`, `404`, or `409` when one is pending/already qualified. |
| `GET /api/challenges/{id}/review-requests?status=pending` | Owner or admin | Lists review requests awaiting a decision; `403` for participants without management rights. `approved` and `rejected` are also accepted filters. |
| `GET /api/challenge-review-inbox` | Eligible reviewer | Pending requests in challenges containing the caller that were requested by someone else and that caller can decide. Response `{reviews:[{challenge:{id,name},review:{id,requesterDisplayName,activity,reason,createdAt}}]}`. |
| `POST /api/challenges/{id}/review-requests/{reviewId}/decision` | Eligible reviewer other than requester | `{decision:"approve"|"reject",reason?}`; approval recomputes scores exactly once. Same decision repeat returns `200` with `idempotent:true`; self-decision is `403`; conflicting repeat is `409`. |
| `POST /api/challenge-devices` | Website/native website session | Exactly `{token,platform:"ios"}`. Stores the raw APNs token encrypted; response is only `{id,platform:"ios",registered:true}`; `201`, `400`, or `503` if encryption is unavailable. |
| `GET /api/challenges/{id}/notification-events` | Participant | Returns only the caller's redacted review-requested/approved/rejected events `{id,type,reviewId,createdAt,delivery}`; delivery is `pending`, `sent`, or `failed`; `401`/`404`. |

Creation example:

```json
POST /api/challenges
{
  "template": "weekly",
  "name": "September Miles",
  "participants": [
    { "userId": "member-id", "role": "member" }
  ],
  "qualifyingActivities": ["Run", "Walk"],
  "sportRules": [
    { "sportType": "Run", "minimum": { "type": "distance", "value": 5000 } },
    { "sportType": "Walk", "minimum": { "type": "time", "value": 1800 } }
  ],
  "scoring": { "mode": "count", "pointsPerActivity": 1 },
  "cadence": { "type": "weekly" },
  "timezone": "America/Halifax",
  "manualReview": true,
  "idempotencyKey": "6fa8d95e-7ead-4f79-bcfd-29a41c08df8d"
}
```

`201` returns a sanitized challenge record such as
`{"id":"challenge_…","name":"September Miles","participants":[{"userId":"caller-id","role":"owner"},{"userId":"member-id","role":"member"}],"rules":{…}}`.
Settings accept the same rule fields (`qualifyingActivities`, `sportRules`,
`thresholds`, `scoring`, `cadence`, `timezone`, `participants`, `manualReview`)
plus `name`. `sportRules` must cover every qualifying activity exactly once;
each rule has a `sportType` and a minimum of `{type:"none",value:null}`,
`{type:"time",value:<seconds>}`, or `{type:"distance",value:<meters>}`.
Legacy challenges without `sportRules` continue to use the shared `thresholds`
object. Threshold keys are `distanceMeters`, `durationSeconds`,
`elevationMeters`, and `activityCount`; scoring modes are `count`, `distance`,
`duration`, and `streak`; cadence is `weekly`, `monthly`, or `season`.

Detail response shape (all values are sanitized):

```json
{
  "id": "challenge_…",
  "participants": [{ "userId": "caller-id", "role": "owner" }],
  "rules": { "qualifyingActivities": ["Run"], "thresholds": { "distanceMeters": 5000 } },
  "currentScore": { "caller-id": 2 },
  "seasonScore": { "caller-id": 2 },
  "activities": [{ "id": "strava_123", "qualifies": false, "reviewState": "pending" }],
  "tiebreakers": [{ "userId": "caller-id", "score": 2, "durationSeconds": 3600, "distanceMeters": 10000 }],
  "history": [{ "at": "2026-09-09T12:00:00.000Z", "type": "review_approved", "score": { "caller-id": 2 } }],
  "reviewState": { "pendingCount": 0 }
}
```

### Native-safe Strava connection

The native client signs in with `POST /api/auth/login`, stores the ordinary
BIG TUNA session securely, and sends it as the bearer credential above. Start
with `POST /api/challenge-accounts/strava/connection/start` and
`{"redirectMode":"native"}`. Open the returned `authorizationUrl` in an
authentication browser session. It is an opaque, short-lived transaction; do
not parse, persist, or share its OAuth state.

After successful authorization the server redirects the browser to
`yannickchallenge://strava-complete?status=success&transaction=<one-time-id>`.
Failure uses `status=failure` when the callback can identify the transaction.
The callback has no Strava token, no BIG TUNA bearer token, and no OAuth state.
`transaction` is only a completion correlation value, not a credential; it is
single-use and expires with the 10-minute transaction. Expired, replayed,
claimed, denied, or malformed transactions fail safely (`400`, typically
`invalid_oauth_state`) and cannot update a connection. The app must then call
`GET /api/challenge-accounts/me` or `GET .../strava/connection` to obtain the
authoritative `strava.connected` status. Website `redirectMode:"web"` and
native connection/reconnection write the exact same account connection.

### Peer review and notifications

Either participant in a two-person challenge may decide the *other* person's
pending request; owner/admin is not required for that decision. For three or
more participants, an eligible reviewer is an owner or admin participant other
than the requester. This rule is used for both the inbox and decision endpoint.
It is separate from management: only owner/admin may update settings or use
management review listing. Every successful decision creates audit/history and
an in-app notification event. An approved activity's score change is performed
in the same serialized decision mutation, so an idempotent repeat does not
recalculate or append history again.

Review-push payloads contain only `eventType`, `challengeId`, `reviewId`, and a
short title/body. A review request targets eligible reviewers; a decision
targets the requester. Events are stored before delivery and remain an in-app
fallback on absent/unavailable APNs. Neither device tokens nor provider error
details appear in responses, event records, or logs. An invalid/unregistered
APNs token disables that device record.

### APNs production configuration

Set deployment-only environment variables (never in a native app, source tree,
or API response): `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`, and
`APNS_AUTH_KEY_BASE64`. The last is the complete UTF-8 contents of Apple’s
`.p8` signing key encoded as base64 (not its filename and not a PEM path).
Set `APNS_ENVIRONMENT=production` for production tokens; use `sandbox` only
for a development/sandbox signing environment. Configure the iOS bundle ID for
Push Notifications in Apple Developer, create an APNs Auth Key with its key ID
and team ID, base64 encode its `.p8` once in the deployment secret manager,
then restart the server with those secrets available. Permit outbound HTTP/2
TLS to `api.push.apple.com` (or `api.sandbox.push.apple.com`) through any host
proxy/firewall; do not MITM APNs TLS.

`CHALLENGE_DEVICE_TOKEN_CRYPTO_SECRET` is also mandatory before device
registration. Generate a high-entropy stable secret (for example
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
store and back it up in the deployment secret manager, and keep it unchanged
while encrypted registrations exist; rotating it without a migration makes old
tokens undecryptable. Missing APNs credentials never means a successful push:
delivery becomes `failed` while the in-app event persists. Missing encryption
key rejects registration with `503`.

## Strava Challenge (the Challengers surface)

The two public reads contain only the service's sanitized dashboard/week data.
The refresh route is limited to configured challenge participants. OAuth and
admin controls remain server-side integrations: never put Strava secrets,
refresh tokens, or invitation credentials in an app.

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `GET /api/strava-challenge/public` | Public | Current cached public dashboard; `503` if service unavailable. |
| `GET /api/strava-challenge/public/weeks/{YYYY-MM-DD}` | Public | Sanitized finalized week data; `404`/`503` as applicable. |
| `POST /api/strava-challenge/refresh` | Challenge participant | No body → refresh status without private sync detail; may return `401`, `403`, `429`, or `503`. |
| `POST /api/strava-challenge/review-requests` | `yannick` or `fishyemma` website session | `{activityId,reason?}` creates a durable review of the caller's own current-week, non-qualifying authoritative activity; `201`, `400`, `403`, `404`, or `409`. The server maps `fishyemma` to Emma; no client participant ID is accepted. |
| `GET /api/strava-challenge/review-requests?status=` | `yannick` or `fishyemma` website session | `{reviews:[...]}` contains only other-participant reviews the caller can decide; accepts `pending`, `approved`, or `rejected`. |
| `POST /api/strava-challenge/review-requests/{reviewId}/decision` | Other fixed participant | `{decision:"approve"|"reject",reason?}`; same decision is idempotent; approval returns `{review,scoreboard,idempotent}` and persists the activity override in the authoritative store. |
| `GET /api/strava-challenge/notification-events` | `yannick` or `fishyemma` website session | Caller-only redacted `{events:[...]}` for `review_requested`, `review_approved`, and `review_rejected`; APNs delivery is `pending`, `sent`, or `failed`. |
| `POST /api/strava-challenge/notification-events/{eventId}/acknowledge` | Fixed event recipient only | No request body. Records the server-clock `acknowledgedAt` receipt and returns `{event,idempotent}`. It is idempotent and means the app processed the event—not that APNs delivered or displayed it; may return `400`, `401`, `403`, `404`, `429`, or `503`. |
| `POST /api/strava-challenge/oauth/prepare` | Public invitation flow | `{inviteToken}` → `{participantId,authorizationUrl}`; the token is body-only, never a URL. |
| `GET /api/strava-challenge/oauth/callback` | Public Strava redirect | Query `code,state,scope` or `error` → success/failure HTML page, not JSON. |
| `GET /api/admin/strava-challenge/status` | Owner | Private challenge configuration/connection status. |
| `PUT /api/admin/strava-challenge/config` | Owner | Bounded scalar configuration object → saved status. |
| `POST /api/admin/strava-challenge/invites/{yannick|emma}/{send|generate}` | Owner | Sends or creates an invite → acknowledgement/expiry, never raw token. |
| `POST /api/admin/strava-challenge/invites/{yannick|emma}/test-link` | Owner | One-time owner test connection URL plus expiry. |
| `POST /api/admin/strava-challenge/sync/{yannick|emma|all}` | Owner | No body → server-side Strava sync result. |
| `GET /api/admin/strava-challenge/finalization-preview?week=` | Owner | Optional `YYYY-MM-DD` → finalization preview. |
| `POST /api/admin/strava-challenge/finalize` | Owner | `{weekStart,confirm:"FINALIZE YYYY-MM-DD"}` → finalized result. |
| `POST /api/admin/strava-challenge/reset-for-season-start` | Owner | `{confirm:"RESET STRAVA CHALLENGE"}` → reset result. |
| `GET /api/admin/strava-challenge/email-preview?type=&participant=` | Owner | Valid email type and `yannick`/`emma` → sanitized message preview. |

## Apple app release catalogue

These responses are deliberately non-static and owner-authenticated. They are
for the private Apple release UI, not public direct installation.

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `GET /api/apple-app-factory/catalog` | Owner | Sanitized release app catalogue and capability flags. |
| `GET /api/apple-app-factory/apps/{slug}` | Owner | Validated slug → release manifest/public record. |
| `GET /api/apple-app-factory/apps/{slug}/icon` | Owner | PNG icon response. |
| `GET /api/apple-app-factory/apps/{slug}/download/{latest|version}` | Owner | Private IPA download; version is validated. |

## Admin, analytics, campaigns, and AI services

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `POST /api/analytics/event` | Public | Bounded `pageview`, `heartbeat`, or `click` beacon (optional body token for attribution) → **204**. Per-IP rate limited; `400`, `413`, or `429` on rejection. |
| `GET /api/admin/overview?range=7|30|90` | Owner | Aggregate analytics dashboard; unknown range defaults to 30. |
| `GET /api/admin/users` | Owner | Per-user 30-day aggregate analytics. |
| `GET /api/admin/users/{id}` | Owner | Valid user ID → single-user analytics/detail. |
| `GET /api/admin/clicks?path=&range=` | Owner | Click/target aggregates filtered by optional path and 7/30/90-day range. |
| `GET /api/admin/email/templates` | Owner | Template metadata/list. |
| `POST /api/admin/email/templates` | Owner | Template fields → newly saved template. |
| `GET /api/admin/email/templates/{id}` | Owner | One validated template. |
| `PUT /api/admin/email/templates/{id}` | Owner | Updated template fields → saved template. |
| `DELETE /api/admin/email/templates/{id}` | Owner | Deletes a template → `{ok:true}`. |
| `GET /api/admin/email/campaigns` | Owner | Campaign list. |
| `POST /api/admin/email/campaigns` | Owner | Campaign fields → new campaign. |
| `GET /api/admin/email/campaigns/{id}` | Owner | One campaign. |
| `PUT /api/admin/email/campaigns/{id}` | Owner | Campaign changes → saved campaign. |
| `DELETE /api/admin/email/campaigns/{id}` | Owner | Deletes campaign → `{ok:true}`. |
| `POST /api/admin/email/campaigns/{id}/send` | Owner | Sends a campaign → delivery/scheduling result. |
| `POST /api/admin/email/campaigns/{id}/test` | Owner | Test-send fields → delivery result. |
| `GET /api/admin/email/campaigns/{id}/open?u=&t=` | Signed recipient link | Records open and returns tracking-pixel response. |
| `GET /api/admin/email/campaigns/{id}/click?u=&t=&url=` | Signed recipient link | Records click then redirects to the validated destination. |
| `GET /api/eco-ai/status` | Website session | Ollama availability, models, limits, and setup/error information. |
| `POST /api/eco-ai/chat` | Website session, NDJSON | Bounded `{messages,skill?,model?}` → streaming model output; see streaming section. |
| `GET /api/trivia/status` | Website session | Question-bank/provider readiness and model metadata. |
| `POST /api/trivia/generate` | Website session | `{topic?,count?,difficulty?,exclude?}` → verified question batch or setup/unavailable error. |

## Assignments, swimming, climbing, quizzes, and meets

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `GET /api/assignments` | Website session | Caller’s assignment-coach dashboard data. |
| `GET /api/assignments/config` | Website session | Sanitized config and current status (never stored credentials). |
| `POST /api/assignments/config` | Website session | Onboarding/settings JSON → save result. |
| `DELETE /api/assignments/config` | Website session | Wipes the caller's assignment data → result. |
| `POST /api/assignments/check-now` | Website session | `{email?}` → manual check result; email boolean controls digest request. |
| `POST /api/assignments/email-now` | Website session | No body → digest send result from current state. |
| `POST /api/assignments/action` | Signed action | `{user,id,action,expires,sig,instructions?}` → action result; rejects invalid/expired signature. |
| `POST /api/parse-pbest` | Public | `{pdf:<base64>}` → parsed SwimRankings personal-best result; `400` on missing/invalid PDF. |
| `GET /api/waquatics/search?name=` | Public | Name of at least two characters → sanitized World Aquatics search result/upstream error. |
| `GET /api/waquatics/athlete?id=` | Public | Numeric athlete ID → sanitized World Aquatics athlete result/upstream error. |
| `GET /api/climbs` | Website session | Caller’s legacy climbs array. |
| `POST /api/climbs` | Website session | Climb collection JSON → `{ok:true}` after per-user save. |
| `GET /api/climbs2` | Website session | Caller’s v2 `{climbs,sessions}`. |
| `POST /api/climbs2` | Website session | `{climbs?,deletedClimbIds?,sessions?}` merge/upsert → `{ok,saved,skipped,deleted}`. |
| `GET /api/climbs2/photo/{id}?t=` | Website session via query token | JPEG photo bytes. |
| `POST /api/climbs2/photo/{id}` | Website session | `{photo:<base64/data URL>}` → `{ok:true}`. |
| `DELETE /api/climbs2/photo/{id}` | Website session | Removes photo if present → `{ok:true}`. |
| `GET /api/quizzes` | Website session | Quiz metadata list with `questionCount`, not questions. |
| `POST /api/quizzes` | Website session | Quiz JSON → saved metadata/`questionCount`; limited per user. |
| `GET /api/quizzes/{id}` | Website session | Full quiz including questions. |
| `PUT /api/quizzes/{id}` | Website session | Replacement quiz JSON → saved metadata/`questionCount`. |
| `DELETE /api/quizzes/{id}` | Website session | Deletes one quiz → `{ok:true}`. |
| `GET /api/meets/psych-sheet` | Website session | Caller’s meet metadata list (not raw text). |
| `POST /api/meets/psych-sheet` | Website session | Meet name/file/settings/raw text → newly saved metadata. |
| `GET /api/meets/psych-sheet/{id}` | Website session | Full meet including raw text/settings. |
| `PATCH /api/meets/psych-sheet/{id}` | Website session | Name and/or scoring settings → updated metadata. |
| `DELETE /api/meets/psych-sheet/{id}` | Website session | Deletes a meet → `{ok:true}`. |

## Shared lists and radar

| Method and path | Access | Request → response summary |
| --- | --- | --- |
| `GET /api/users/lookup?username=` | Website session | Safe `{id,username}` for another account; rejects self lookup. |
| `GET /api/shared-lists` | Website session | Lists only shared lists containing the caller. |
| `POST /api/shared-lists` | Website session | `{name,memberUsernames?,emoji?,color?}` → newly created list. |
| `GET /api/shared-lists/{id}` | Member | Full shared list. A missing/nonmember list returns `404`. |
| `POST /api/shared-lists/{id}` | Member | Allowed presentation/item fields → updated list and member SSE broadcast. |
| `DELETE /api/shared-lists/{id}` | Member | Owner deletes; another member leaves → `{ok:true}` and broadcast. |
| `GET /api/shared-lists/{id}/events` | Member SSE | Header bearer or `?t=` token; see streaming section. |
| `OPTIONS /api/radar/yhz` | Public | CORS preflight → **204**, allows `GET, OPTIONS`. |
| `GET /api/radar/yhz` | Public | Compact YHZ aircraft feed for the radar display; upstream/cache error shape when unavailable. |

## Streaming and WebSocket protocols

| Endpoint | Access | Protocol behaviour |
| --- | --- | --- |
| `GET /api/lights/events` | Public | `text/event-stream`; immediately writes the desired lights state, broadcasts later changes, and writes SSE comment keepalives every 15 seconds. |
| `GET /api/shared-lists/{id}/events` | Member | `text/event-stream`; accepts bearer header or `?t=`, writes an initial comment, broadcasts list updates/deletions, and sends comment keepalives every 25 seconds. |
| `POST /api/eco-ai/chat` | Website session | `application/x-ndjson`; first `meta`, then `delta` records, 15-second `ping` records, and terminal `done` or `error` record. Clients must tolerate incomplete streams/disconnects. |
| `WS /terminal/ws?t=<website-session>&cols=&rows=` | Owner only | WebSocket upgrade, not a normal HTTP route. Maximum five concurrent isolated PTYs. Text input is forwarded; JSON `{type:"resize",cols,rows}` resizes it; server data is sent as WebSocket messages; ping every 30 seconds. Unauthorized/nonowner/full upgrade gets `401`/`403`/`503`. This is terminal UI only, never an app integration. |

## Static application delivery and fall-through

`GET /` and folder-style app paths are served from `apps/`; a directory with an
`index.html` serves that file, while a directory without one receives an
auto-index. `GET /topbar.js`, `GET /auth.js`, and `/styles/tokens.css` map to
their shared assets. `/favicon.ico` returns `204`. HTML, JavaScript, and CSS
are served with no-cache semantics. Static paths are not an API inventory and
must not be used to expose data stored outside `apps/`.

Every unmatched `/api/…` request ends as `404 {"error":"API route not found"}`.

## Source reconciliation

This reference was reconciled against the conditional routes in `handleAPI()`
and the `/terminal/ws` upgrade handler in `server.js`. `API_CONTRACT.md` and
`openapi.yaml` correctly describe the native Lights subset; this file also
records the currently live public `/api/parse-pbest` and World Aquatics proxy
routes as public, matching executable code. Update all three references when a
supported native endpoint changes.

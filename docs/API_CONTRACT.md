# BIG TUNA HTTP API contract

Base URL: `https://yannickmorgans.ca` (local development: `http://localhost:3000`).
This document records the current server routes relevant to supported clients.
`server.js` remains the executable authority; `docs/openapi.yaml` is the
machine-readable contract for the native Yannick Lights integration surface.

## Authentication and errors

Website-authenticated routes use `Authorization: Bearer <website-session>`.
Native Lights routes accept a Lights-scoped bearer token after its exchange.
Browser image streams that cannot set headers may use their documented `t`
query token. Unless otherwise stated, successful JSON responses use HTTP 200
and failures use `{ "error": "..." }`.

The server enforces user isolation on per-user stores. Owner-only means the
authenticated username is `yannick`; hiding a client control is never
authorization. Do not send a website password, website bearer token, native
bearer token, relay token, or Apple credential to an untrusted client or log.

## Yannick Lights native integration

The native app uses physical-light terms and never calls the relay protocol.
The legacy website/ESP stored `on` value is intentionally inverted at the
server boundary. See `docs/openapi.yaml` for schemas and error responses.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/lights/native/v1/session` | owner website session | Exchange a temporary website session for a revocable Lights-only token. |
| DELETE | `/api/lights/native/v1/session` | token optional | Revoke the supplied native token; returns `{ok:true}` even when absent. |
| GET | `/api/lights/native/v1` | owner Lights-scoped token | Read authoritative desired physical state and trusted relay status. |
| PUT | `/api/lights/native/v1` | owner Lights-scoped token | Set explicit `physicalOn` with a retry-safe `commandId`. |
| GET | `/api/strava-challenge/public` | public | Read the cached weekly Yannick-versus-Emma score used by native score surfaces. |

`commandId` is a 1–128 character URL-safe identifier. Repeating an ID for the
same target is idempotent; using it for a different target returns `409`.
Native state must only be cached after a successful GET or PUT response.

## Legacy Lights and relay routes

| Method | Route | Access | Contract |
| --- | --- | --- | --- |
| GET | `/api/lights` | public | Historical desired stored state `{on, updatedAt}`. |
| POST | `/api/lights` | public | Update historical desired stored state with strictly validated `{on:boolean}`. |
| GET | `/api/lights/events` | public SSE | Desired-state stream; initial state followed by changes and 15-second keepalives. |
| GET | `/api/lights/homekit` | owner website session | HomeKit availability/pairing status. |
| GET | `/api/lights/homekit/qr` | owner website session | Unpaired setup QR SVG only; never cache it. |
| GET | `/api/lights/device` | relay token when configured | Legacy relay desired state, possibly inverted, plus `pollAfterMs`. |
| GET | `/api/lights/device/status` | public | Sanitized trusted relay heartbeat/status. |
| POST | `/api/lights/device/status` | relay token when configured | Report relay `{on:boolean}`; response says whether the report was trusted. |

The relay token is `X-Big-Tuna-Device-Token` only when
`LIGHTS_DEVICE_API_TOKEN` is configured. Native clients must never use or ship
that header. The current polling hint is 250 ms and trusted-heartbeat window is
5 seconds; firmware must preserve its own bounded retry/backoff and safe last
known state behavior.

The legacy `POST /api/lights` route is public. It accepts only a JSON object
with a Boolean `on` field; malformed JSON, a missing `on`, or any non-Boolean
value is rejected with `400`. This public legacy route does not change the
owner-only native and HomeKit boundaries or the device-token boundary.

## Route inventory

The tables below are an implementation inventory for the complete current HTTP
surface. `server.js` remains authoritative for exact field validation and
response payloads. `Used by` identifies the current browser/native/device or
external consumer; it is not permission to expose a private route.

### Authentication, account, and settings

| Method/path | Request | Response and errors | Auth / used by |
| --- | --- | --- | --- |
| `POST /api/auth/register` | JSON username/password (and accepted account fields) | Created user/session shape; `400` validation/conflict | Public; login UI |
| `POST /api/auth/login` | JSON username/password | Session token/user; `401` invalid credentials | Public; website and native sign-in bootstrap |
| `POST /api/auth/logout` | Bearer website session | `{ok:true}`; safe repeated logout | Website session; browser auth client |
| `GET /api/auth/me` | Bearer website session | Current sanitized user; `401` | Website auth client |
| `POST /api/auth/set-email` | `{email}`; empty clears it | `{ok:true}`/user update; `400`, `401` | Authenticated account UI |
| `POST /api/auth/forgot-password` | `{username}` | Always `{ok:true}` to prevent account enumeration | Public; login UI; may call Resend |
| `POST /api/auth/reset-password` | `{token,password}` | `{ok:true}`; `400` expired/invalid token | Public reset link; invalidates user sessions |
| `POST /api/account/test-email` | No secret-bearing fields | Diagnostic send result; `401/403` | `yannick` only; temporary admin diagnostic |
| `GET/POST /api/settings/{appId}` | JSON app settings on POST | Per-user JSON settings; `400/401` | Authenticated browser apps |
| `GET/POST /api/data/{appId}` | JSON app data on POST | Per-user JSON data; `400/401` | Authenticated browser apps/future apps |

### Apple releases and native app consumers

| Method/path | Request | Response and errors | Auth / used by |
| --- | --- | --- | --- |
| `GET /api/apple-app-factory/catalog` | None | Sanitized release catalog; `401/403` | Owner-authenticated `/apple-apps/` |
| `GET /api/apple-app-factory/apps/{slug}` | Safe slug | Release manifest; `404`, `401/403` | Private Apple release UI |
| `GET /api/apple-app-factory/apps/{slug}/icon` | Safe slug | PNG; `404`, `401/403` | Private Apple release UI |
| `GET /api/apple-app-factory/apps/{slug}/download/{version}` | `latest` or safe version | Private IPA download; `404`, `401/403` | Owner-controlled installer; never static/public |
| `POST /api/lights/native/v1/session` | No body; website Bearer | `{token,username}`; `401/403` | Yannick Lights iPhone bootstrap |
| `DELETE /api/lights/native/v1/session` | Native Bearer optional | `{ok:true}` | Yannick Lights logout/extensions |
| `GET /api/lights/native/v1` | Native Lights Bearer | Physical state object; `401/403` | iPhone, Watch, widgets, controls |
| `PUT /api/lights/native/v1` | `{physicalOn:boolean,commandId}` | Physical state object; `400/401/403/409/413` | iPhone, Watch, widgets, controls |
| `GET /api/strava-challenge/public` | None | Sanitized cached dashboard; `503` if unavailable | Homepage, native score widgets |

### Lights, HomeKit, and ESP8266/ESP32 relay

| Method/path | Request | Response and errors | Auth / used by |
| --- | --- | --- | --- |
| `GET /api/lights` | None | `{on,updatedAt}`; normal server errors | Public Lights website |
| `POST /api/lights` | Strict `{on:boolean}` | `{on,updatedAt}`; `400` invalid body | Public Lights website |
| `GET /api/lights/events` | None | SSE desired-state events + keepalives | Lights website; public browser stream |
| `GET /api/lights/homekit` | Website Bearer | Pairing status; `401/403` | Owner Lights UI |
| `GET /api/lights/homekit/qr` | Website Bearer | SVG setup QR; `401/403/409/503` | Owner pairing UI; no caching |
| `GET /api/lights/device` | `X-Big-Tuna-Device-Token` when configured | Relay desired state and polling hint; `401` | ESP8266/ESP32 relay firmware |
| `GET /api/lights/device/status` | None | Sanitized heartbeat status | Website/device status UI |
| `POST /api/lights/device/status` | Relay status JSON, device header when configured | Trust/result status; `400/401` | ESP8266/ESP32 telemetry |

### Strava challenge and leaderboard

| Method/path | Request | Response and errors | Auth / used by |
| --- | --- | --- | --- |
| `GET /api/strava-challenge/public` | None | Current score, history, sanitized activities/stats | Public homepage/native score consumers |
| `GET /api/strava-challenge/public/weeks/{YYYY-MM-DD}` | Week path | Sanitized finalized week; `404/503` | Public challenge detail UI |
| `POST /api/strava-challenge/refresh` | None | Refresh status/partial result; `401/403/429/503` | Authenticated challenge participants/homepage |
| `POST /api/strava-challenge/oauth/prepare` | `{inviteToken}` | `{participantId,authorizationUrl}`; `400/503` | Challenge connect page |
| `GET /api/strava-challenge/oauth/callback` | Strava `code,state,scope` or error query | HTML success/failure page; `400` | Strava OAuth redirect |
| `GET /api/admin/strava-challenge/status` | None | Private configuration/connection status | `yannick` admin |
| `PUT /api/admin/strava-challenge/config` | Bounded scalar config JSON | Updated status; `400/403` | `yannick` admin |
| `POST /api/admin/strava-challenge/invites/{participant}/{send|generate|test-link}` | Participant path | Send acknowledgement or one-time test URL; `400/403` | `yannick` admin; Resend |
| `POST /api/admin/strava-challenge/sync/{yannick|emma|all}` | None | Sync result; service/rate-limit errors | `yannick` admin; Strava API |
| `GET /api/admin/strava-challenge/finalization-preview` | Optional `week` query | Preview score; `400/403` | `yannick` admin |
| `POST /api/admin/strava-challenge/finalize` | `{weekStart,confirm:"FINALIZE YYYY-MM-DD"}` | Finalized result; `400/403` | `yannick` admin |
| `POST /api/admin/strava-challenge/reset-for-season-start` | `{confirm:"RESET STRAVA CHALLENGE"}` | Reset result; `400/403` | `yannick` admin |
| `GET /api/admin/strava-challenge/email-preview` | `type`, `participant` query | Sanitized preview; `400/403` | `yannick` admin |

### Admin, analytics, automation, and external-service proxies

| Method/path family | Request/response | Auth / used by |
| --- | --- | --- |
| `POST /api/analytics/event` | Bounded pageview/heartbeat/click beacon; `{ok:true}` or validation error | Public beacon from shared `topbar.js` |
| `GET /api/admin/overview?range=7|30|90`, `GET /api/admin/users`, `GET /api/admin/users/{id}`, `GET /api/admin/clicks?path=&range=` | Admin aggregate JSON; bounded query errors | `yannick` admin dashboard |
| `GET/POST /api/admin/email/templates[/{id}]`, `PUT/DELETE /api/admin/email/templates/{id}` | Template JSON/HTML; validation/not-found errors | `yannick` admin; local Resend templates |
| `GET/POST /api/admin/email/campaigns[/{id}]`, `PUT/DELETE /api/admin/email/campaigns/{id}` | Campaign JSON; validation/not-found errors | `yannick` admin |
| `POST /api/admin/email/campaigns/{id}/send` and `/test` | Send/test request; delivery result/errors | `yannick` admin; Resend |
| `GET /api/admin/email/campaigns/{id}/open` and `/click` | `u,t,url` tracking query; pixel/redirect | Public email recipient links; signed tracking token |
| `GET /api/eco-ai/status` | Ollama status/model list | Website bearer; Eco AI UI |
| `POST /api/eco-ai/chat` | Bounded chat JSON; streamed model response | Website bearer; Ollama external local API |
| `GET /api/trivia/status`, `POST /api/trivia/generate` | Readiness or generated verified question batch | Website bearer; Trivia UI; configured model provider |
| `GET/POST/DELETE /api/assignments*` | Per-user setup, state, check/email/action results | Website bearer; Assignment Coach and signed email actions |
| `POST /api/parse-pbest` | SwimRankings PDF body; parsed times or parse errors | Website bearer; Psych Sheet UI |
| `GET /api/waquatics/search?name=...`, `GET /api/waquatics/athlete?id=...` | Sanitized proxy results/errors | Website bearer; swim apps; World Aquatics upstream |
| `GET/POST /api/climbs`, `GET/POST/DELETE /api/climbs2`, `POST/DELETE /api/climbs2/photo/{id}`, `GET /api/climbs2/photo/{id}?t=` | Per-user climbs/sessions/photos; validation/auth errors | Website bearer or short-lived image token; climb apps |
| `GET/POST/PUT/DELETE /api/quizzes[/{id}]` | Quiz metadata/questions; validation/not-found errors | Website bearer; Quiz UI |
| `GET/POST/PATCH/DELETE /api/meets/psych-sheet[/{id}]` | Meet metadata/raw text/settings; validation/not-found errors | Website bearer; Psych Sheet UI |
| `GET /api/users/lookup?username=...` | Safe user id/name; `401/404` | Website bearer; shared-list member picker |
| `GET/POST/DELETE /api/shared-lists[/{id}]`, `POST /api/shared-lists/{id}`, `GET /api/shared-lists/{id}/events` | Member-scoped list JSON and SSE; `401/403/404` | Website bearer/list membership; List Maker UI |
| `GET /api/radar/yhz` and `OPTIONS` | Compact aircraft feed/CORS preflight | Public ESP8266 radar display; upstream aircraft source |

### Streaming and WebSocket protocols

- `GET /api/lights/events` is public SSE. It sends the current desired light
  state immediately, then state events and comment keepalives every 15 seconds.
- `GET /api/shared-lists/{id}/events` is member-authenticated SSE. A bearer
  header or `t` query token is accepted because browser EventSource cannot set
  headers; membership is rechecked before the stream is created.
- `POST /api/eco-ai/chat` may proxy a streamed Ollama response; clients must
  treat disconnects and upstream errors as incomplete assistant output.
- WebSocket `GET /terminal/ws?t=<website-session>&cols=&rows=` is not an HTTP
  API route: it requires the owner website session, caps concurrent sessions at
  five, and starts an isolated PTY worker. It is used only by the owner terminal
  UI and must never be exposed to app clients.

## Important external APIs

- Strava OAuth and `/api/v3/athlete/activities` are used only by the server-side
  Strava challenge service; client secrets and refresh/access tokens stay in
  server configuration/state.
- Resend is used server-side for password reset, assignment, challenge, and
  campaign email delivery; API keys remain in `server.env`.
- Ollama is a local server-side API for Eco AI; its bearer/session details are
  not part of the browser contract.
- World Aquatics/SwimRankings and the YHZ radar upstream are server-side proxy
  dependencies; their credentials, if any, never belong in app repositories.

When changing any native route, update `server.js`, this document,
`docs/openapi.yaml`, and the native app’s `API-DISCOVERY.md` together. A
generated app-local copy is convenience documentation only and must say so.

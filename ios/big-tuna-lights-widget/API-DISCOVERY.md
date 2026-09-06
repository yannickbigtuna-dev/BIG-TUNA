# Yannick Lights API discovery

This document records the server contract used by the native Yannick Lights
clients. It intentionally excludes passwords, website session tokens, native
bearer tokens, Strava OAuth credentials, device tokens, LAN addresses, and
private state files.

Base URL: `https://yannickmorgans.ca`

## Native Lights API (used by iPhone, Watch, widgets, and controls)

The native app does **not** talk to the ESP relay directly. It uses the
owner-authenticated server proxy, whose versioned contract expresses the
*physical* light state. This is important: the historical website/ESP stored
relay value is inverted. Native clients must never perform that inversion
themselves.

### Authentication

1. The iPhone signs in to the existing website with `POST /api/auth/login`.
   The normal website session is only transient.
2. The iPhone exchanges that session for a revocable, Lights-only token with
   `POST /api/lights/native/v1/session` and immediately disposes of the normal
   website session through the usual logout flow.
3. The native token is sent as `Authorization: Bearer <redacted>` to the
   native state endpoint. It is stored in the shared App Group `UserDefaults`
   used by the app and its extension, and is synchronized to the paired Watch
   only as needed. It is revoked on logout or cleared after an authentication
   failure. The token is scoped to Lights control and cannot access the owner's
   other website data.

`POST /api/lights/native/v1/session` returns a sanitized shape like:

```json
{ "token": "<revocable-lights-only-token>", "username": "yannick" }
```

It returns `401 {"error":"Not authenticated"}` without a valid website
session and `403 {"error":"Forbidden"}` for a non-owner.

### Read real state

`GET /api/lights/native/v1`

Requires the Lights-only Bearer token. A successful sanitized response is:

```json
{
  "physicalOn": true,
  "reportedPhysicalOn": true,
  "recentlyPolled": true,
  "revision": "42",
  "updatedAt": "2026-09-05T15:04:05.000Z"
}
```

- `physicalOn` is the server's desired physical light state and is the source
  of truth shown by the app.
- `reportedPhysicalOn` is the latest trusted relay report, or `null` when no
  trusted report is known.
- `recentlyPolled` says whether the relay has checked in within the server's
  short heartbeat window.
- `revision` and `updatedAt` support reconciliation and cache freshness.

The endpoint returns `401` for a missing/expired native token and `403` for a
token that is not the owner. Clients treat any non-2xx status or malformed JSON
as a failed refresh, retain only the previously confirmed cache, and surface an
offline/error state rather than inventing a new light state.

### Set ON or OFF (and native toggle)

`PUT /api/lights/native/v1`

Headers:

```http
Authorization: Bearer <redacted>
Content-Type: application/json
```

Body:

```json
{ "physicalOn": false, "commandId": "550e8400-e29b-41d4-a716-446655440000" }
```

The response uses the same authoritative state schema as `GET`. `commandId`
must be a 1–128-character URL-safe identifier. It makes a retry idempotent:
repeating the same ID with the same target returns the remembered result;
reusing it for a different target is rejected. The server serializes mutations
to avoid competing rapid toggles.

There is no separate native `toggle` HTTP endpoint. `toggleLight()` first reads
the current server state, derives an explicit target, then sends this `PUT`.
It caches the authoritative command response, follows it with a reconciliation
GET when possible, and reloads widgets/controls. If that verification GET fails,
the successful PUT result remains the last authoritative state and the UI marks
verification unavailable rather than falsely claiming the command failed. A `400` error covers malformed
JSON, a non-Boolean `physicalOn`, or invalid/conflicting command IDs. Standard
server failures are reported as non-2xx errors. URLSession requests use the
project's bounded timeout and limited safe retry behavior for transient reads;
commands retain their command ID if retried.

## Existing website/legacy Lights API

The web page at `/lights/` is retained for browser/HomeKit/scheduler
compatibility, but the native app does not use it for writes.

- `GET /api/lights` is public and returns the historical desired stored value:
  `{"on":true,"updatedAt":"..."}`. The website translates it through its
  `apiToWebsiteState` boundary because the historic relay wiring is inverted.
- `POST /api/lights` requires an ordinary website Bearer session for the
  `yannick` account. It accepts `{"on":true}` and returns
  `{"on":true,"updatedAt":"..."}`. The server rejects unauthenticated and
  non-owner callers with 401/403 and rejects invalid bodies.
- `GET /api/lights/events` is a public server-sent-event desired-state stream.
- `GET /api/lights/device` and `POST /api/lights/device/status` are relay
  protocol endpoints. Where configured, they require the private
  `X-Big-Tuna-Device-Token`; native apps must never call them or ship that
  credential. `GET /api/lights/device/status` exposes safe heartbeat status.

The relay protocol's stored `on` is intentionally inverted from physical ON.
The server's `lights-native-control` adapter is the single translation point.
Do not copy legacy inversion logic into Swift, widgets, or App Intents.

Security note: public legacy state/heartbeat reads reveal whether a light is
desired on, while writes remain owner-gated. The native endpoint improves the
client boundary through a revocable, least-privilege token. If public state
visibility becomes undesirable, changing it is a server/product decision and
must preserve website/ESP compatibility; do not expose a LAN relay address or
device credential as a workaround.

## Yannick vs Emma weekly score API

`GET /api/strava-challenge/public`

This is a public, read-only endpoint. It returns the server's cached Strava
challenge dashboard; it does not expose Strava access/refresh tokens and does
not make a live Strava request for every widget refresh. A sanitized relevant
portion is:

```json
{
  "configured": true,
  "challenge": { "name": "Strava Cup", "year": 2026, "timezone": "America/Halifax" },
  "participants": { "yannick": { "name": "Yannick", "color": "red" }, "emma": { "name": "Emma", "color": "blue" } },
  "currentWeek": {
    "weekStart": "2026-08-31",
    "dateLabel": "Aug 31 – Sep 6",
    "score": { "yannick": 4, "emma": 3 },
    "winner": "yannick"
  },
  "lastUpdatedAt": "2026-09-05T14:30:00.000Z",
  "stale": false
}
```

The app reads `currentWeek.score.yannick` and `.emma`, `weekStart` and/or
`dateLabel`, `winner`, `lastUpdatedAt`, and `stale`. The weekly score is the
count of qualifying activities, not the season points. The server calculates
the current week with the challenge's configured `America/Halifax` time zone
and returns the current period's `weekStart`/`dateLabel`; clients display those
server-provided values rather than calculating a competing week boundary.
Tied qualifying-activity counts can be resolved server-side using qualifying
activity time; `winner` conveys that result where useful.

The service keeps the latest compact valid score in the shared App Group.
On a failed refresh, malformed response, no network, or temporary Strava/server
outage, widgets continue showing that cached score and can mark it stale. They
never substitute fake `0–0` data for a known cached score and use WidgetKit
timeline refreshes rather than continuous polling.

The endpoint returns normal HTTP error responses when the challenge service is
unavailable; the client treats non-2xx as refresh failure. Public dashboard
data is intentionally safe for a score widget. Do not use owner-only refresh,
admin, OAuth, or participant-management endpoints from the app.

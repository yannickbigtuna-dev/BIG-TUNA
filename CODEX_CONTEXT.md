# BIG-TUNA Codex Context

Read this file after `AGENTS.md` at the start of every Codex session. It is the compact project map so Codex does not need to reread the whole repository before making normal changes.

When a change affects architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards, update this file in the same commit.

## Project Purpose

BIG-TUNA is a personal self-hosted website at `yannickmorgans.ca`. It runs on a Windows machine, serves a collection of single-page apps, stores live state in local files under `data/`, and is exposed publicly through Cloudflare Tunnel. The live server auto-pulls from GitHub, so pushes to `main` can affect the live site.

## Mandatory Workflow

1. Run `git pull origin main` before making changes.
2. Start with the most capable available model acting as architect and top-level coordinator.
3. The architect must inspect only the files needed after reading this context, then produce a thorough implementation spec before coding starts.
4. That spec must be strong enough to act as the acceptance and testing guide for the final validation pass.
5. Delegate implementation work to cheaper sub-agents whenever practical, using prompts derived from the architect spec.
6. After sub-agents report back, use the most capable available model again as the testing and validation agent.
7. The testing agent must verify the implementation against the spec, check for regressions, and decide whether the work is complete.
8. If the work is not good enough, run another sub-agent implementation pass using the testing feedback, then retest.
9. Once the work passes the spec, make the requested edits final.
10. Run `git status` and `git diff`.
11. Do not commit secrets, `.env`, `node_modules`, cache/build junk, or local machine-only files.
12. Commit completed changes with a clear message.
13. Push with `git push origin main`.
14. Tell the user what changed and that it was pushed.

Do not force push or rewrite history. If `git pull` produces a merge conflict, stop and explain it.

## Repository Layout

```text
.
+-- AGENTS.md                 # Codex operating instructions for this repo
+-- CODEX_CONTEXT.md          # This file; persistent project context for Codex
+-- README.md                 # User/deployment documentation
+-- CLAUDE.md                 # Older assistant context; may overlap with this file
+-- server.js                 # Main app/API/static server, CommonJS, port 3000
+-- pty-worker.js             # Child process worker for web terminal PTY sessions
+-- package.json              # Main server npm metadata
+-- apps/                     # Static browser apps plus shared client scripts
+-- data/                     # Live file-based app data; treat as production state
+-- mcp-server/               # Separate MCP HTTP server, ES modules, port 3001
+-- ios/                      # Native Apple platform source checked into the repo
+-- cloudflared-config.yml    # Cloudflare Tunnel ingress config
+-- *.bat, *.ps1              # Windows setup/start/helper scripts
+-- open-big-tuna-codex.ps1  # Local helper: pulls latest main and launches Codex in this repo
```

Important local-machine assumptions: several scripts and log messages still refer to `C:\SERVER`, while this checkout may be `C:\BIG-TUNA`. Be careful before changing paths; deployment scripts may rely on the production path.

## Runtime Architecture

There are two Node servers.

Main server:

- File: `server.js`
- Port: `3000`
- Module system: CommonJS
- Dependencies used directly: Node stdlib, `ws`, `node-pty` through `pty-worker.js`, Puppeteer packages for PDF/parsing-related features and Brightspace browser automation.
- Responsibilities: static file serving from `apps/`, all `/api/*` routes, auth/session management, local file persistence, shared-list Server-Sent Events, web terminal WebSocket upgrades, and the assignment coach scheduler.
- The assignment coach workflow is loaded from `lib/assignment-coach.js`. It is multi-user: each user stores encrypted Brightspace credentials and their own scraped state under `data/assignments/users/{userId}/`. It uses Puppeteer (credential-based headless login + scraping), the Anthropic Messages API (Claude Opus 4.8) for coaching, Resend email, AES-256-GCM credential encryption, signed/per-user action links, and a daily morning scheduler. `data/assignments/` is gitignored (credentials and browser profiles must never be committed).

MCP server:

- File: `mcp-server/server.js`
- Port: `3001`
- Module system: ES modules
- Dependencies: `@modelcontextprotocol/sdk`, `zod`
- Public endpoint: `/mcp`, usually exposed as `https://mcp.yannickmorgans.ca/mcp`
- Auth: bearer token from `MCP_SECRET`, loaded by `mcp-server/ecosystem.config.cjs` from `mcp-server/token.txt`.
- Tools: `read_file`, `write_file`, `list_directory`, `run_command`, `server_status`.
- Path safety is rooted to `C:\SERVER`.

Cloudflare Tunnel routes public hostnames to local services:

- `yannickmorgans.ca` and `www.yannickmorgans.ca` -> `http://localhost:3000`
- `mcp.yannickmorgans.ca` -> `http://localhost:3001`
- `ssh.yannickmorgans.ca` -> `ssh://localhost:22`

## Development Commands

Main server:

```powershell
npm install
npm start
```

The main server listens at `http://localhost:3000`.

MCP server:

```powershell
cd mcp-server
npm install
node server.js
```

Production/service commands used by docs and scripts:

```powershell
pm2 start C:\SERVER\server.js --name apps-server
pm2 restart apps-server
pm2 logs apps-server
pm2 status

pm2 start C:\SERVER\mcp-server\ecosystem.config.cjs
pm2 restart mcp-server

sc start cloudflared
sc stop cloudflared
sc query cloudflared
```

One-click live startup:

```powershell
.\start-all.bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SERVER\start-everything.ps1
```

`start-everything.ps1` is the canonical local orchestrator. It starts or restarts PM2 apps `apps-server` and `mcp-server`, saves the PM2 process list, starts `cloudflared.exe` with `cloudflared-config.yml` only when the tunnel process is absent, and starts `auto-update.ps1` hidden when the git reloader is absent. `auto-update.ps1` polls `origin/main` every 10 seconds, pulls newer commits, and restarts PM2 app `apps-server` after a successful pull so `server.js` route changes take effect.

`start-everything.ps1` now also makes a best-effort, non-blocking attempt to start the local Ollama API before the rest of the stack so Eco AI is ready sooner after boot.

There is no build step. Frontend files in `apps/` are served directly. Restart Node after changing `server.js` or `pty-worker.js`.

Current `npm test` is a placeholder that exits with failure, so do not treat it as a useful test suite unless it has been changed.

## Main Server Details

`server.js` initializes required data directories on boot:

- `data/`
- `data/climbs/`
- `data/settings/`
- `data/appdata/`
- `data/meets/`
- `data/climb-tracker/`
- `data/quizzes/`
- `data/shared-lists/`
- `data/lights/`
- `data/assignments/`

It creates `data/users.json` and `data/sessions.json` if missing.

Persistence uses `atomicWrite(filePath, data)` for JSON writes: write `file.tmp`, then rename. Preserve this pattern for important JSON state.

User-controlled IDs used in filenames must pass `isValidId(id)`: alphanumeric, underscore, hyphen, length 1-64. Use this or a similarly strict validator for any new file-backed route.

Static serving:

- Static root is `apps/`.
- `/` serves `apps/index.html`.
- `/topbar.js` and `/auth.js` are served from `apps/topbar.js` and `apps/auth.js`.
- `/styles/tokens.css` is served from `apps/styles/tokens.css` — the shared design-token stylesheet every app links (see Frontend App Conventions).
- HTML, JS, **and CSS** responses are sent with `Cache-Control: no-cache`.
- `/favicon.ico` returns HTTP 204 with a short cache lifetime so browser default favicon probes do not create noisy 404s.
- App URLs are folder-based, for example `/list-maker/` maps to `apps/list-maker/index.html`.
- HTML and JS responses are sent with `Cache-Control: no-cache`.
- Directories without an `index.html` get a generated auto-index page.

## Authentication

Auth is custom and file-backed.

- Users live in `data/users.json`.
- Sessions live in `data/sessions.json`.
- Sessions are bearer tokens with 30-day expiry.
- Passwords are SHA-256 with per-user random salt, not bcrypt.
- `writeSessions()` prunes expired sessions on write.
- Frontend token and user cache are in `localStorage` keys `auth_token` and `auth_user`.

Shared auth client:

- File: `apps/auth.js`
- Include with `<script src="/auth.js"></script>`.
- Use `Auth.onReady(callback)` before starting app behavior that needs a user.
- `Auth.token` and `Auth.user` expose current auth state.
- `Auth.saveSettings(appId, data)` and `Auth.loadSettings(appId)` use `/api/settings/:appId`.
- `Auth.autoSync(appId, getDataFn, options)` periodically saves settings, retries failures, saves before logout, and attempts `keepalive` before unload.
- `Auth.beforeLogout(fn)` lets apps flush state.

Auth routes:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Most app data routes require:

```text
Authorization: Bearer <token>
```

Some streaming/image routes accept token query parameter `t` because browser APIs cannot always set auth headers.

## Frontend App Conventions

Each app is a standalone HTML file at `apps/{app-id}/index.html`. There is no frontend bundler.

Standard app boot pattern:

```html
<head>
  <link rel="stylesheet" href="/styles/tokens.css">
</head>
<body>
  <script src="/topbar.js"></script>
  <script src="/auth.js"></script>
  <script>
    Topbar.setTitle('My App');
    Auth.onReady(user => {
      // Start app here.
    });
  </script>
</body>
```

Design tokens (`apps/styles/tokens.css`):

- The single source of truth for color, type, spacing, radius, and elevation, plus the CSS reset, accessible focus ring, and opt-in `.btn`/`.field`/`.card` primitives.
- Every app links it in `<head>` and derives all styling from `var(--…)`. Do **not** hardcode hex colors, ad-hoc border-radii, or one-off box-shadows in an app.
- The visual language is now a dark glass system: pure-black background, translucent/blurred surfaces, Geist and Geist Mono typography, and a default coral-red brand accent.
- `tokens.css` also defines a shared rainbow accent ramp (`--c-red` through `--c-pink`). `topbar.js` can override `--accent` per app based on the current route so shared primitives inherit an app-specific tint without each app redefining styles.
- Per-app accent colors are part of the shared launcher/topbar language now; avoid random one-off decorative colors outside that shared token system.
- `topbar.js` and `auth.js` inject their CSS via `var(--…)` too, so they restyle with the tokens. Multiple distinct colors are only acceptable in genuine data visualization (chart series, climbing hold colors, map data) — not as decoration.
- See `ARCHITECTURE.md` for the full pattern summary and token table.

Shared topbar:

- File: `apps/topbar.js`
- Include before `auth.js`.
- APIs: `Topbar.setTitle(title)`, `Topbar.addLeft(element)`.
- It injects a sticky nav with HOME, APPS dropdown, centered title, and `[data-auth-widget]` slot.
- It also applies the route-specific accent override early on load so each app can inherit its assigned shared-token tint.
- The APPS dropdown list is hardcoded in `topbar.js`; update it when adding/removing visible apps.

Homepage:

- File: `apps/index.html`
- Custom launcher page with clock, weather/temperature widget, and app cards.
- The launcher uses a glass top nav, a centered floating glass dock at the bottom, a rainbow-tinted app grid, and a pointer-following ambient background on fine-pointer devices.
- Hero layout (top to bottom): the uppercase date line, the large glowing coral "BIG TUNA" wordmark, then a digit-slot clock (HH:MM:SS) whose seconds digits glow coral and whose digits roll on change. App labels are uppercase Geist Mono.
- The bottom floating dock groups three controls in one glass capsule: a coral primary MIN pill (minimal mode), a DOWNLOADS pill, and an icon-only lights link. The downloads menu pops upward from the dock.
- The visual direction was generated with the Stitch design MCP; the reference screenshot is saved at `docs/design/homepage-stitch-reference.png`. The page is hand-rebuilt natively (no Tailwind/CDN) on `/styles/tokens.css` so all live behaviour and conventions are preserved.
- Has a persisted minimal mode toggled by the dock's MIN pill; minimal mode hides homepage chrome, app cards, downloads menu, and lights link, leaving BIG TUNA, date, clock, and the exit (MIN) button.
- The dock's downloads menu lists release-asset downloads for the Lights app, Weather app, and the BIG TUNA Codex macOS launcher.
- The top-right homepage weather widget links to `/weather/` and displays Open-Meteo apparent temperature. It tries browser geolocation first and falls back to Halifax coordinates (`44.6488,-63.5752`) when geolocation is denied, unavailable, times out, or the first weather request fails.
- Adding an app may require updating both homepage cards and `topbar.js`, even though the static server can auto-index folders.

Current app folders:

- `apps/assignments/`
- `apps/capitals-quiz/`
- `apps/climb-tracker/`
- `apps/eco-ai/`
- `apps/list-maker/`
- `apps/lights/`
- `apps/pace-calculator/`
- `apps/psych-sheet/`
- `apps/quiz-app/`
- `apps/terminal/`
- `apps/weather/`
- `apps/workout-timer/`
- `apps/world-map/`

## Assignment Coach

The `/assignments/` app is a **per-user** Brightspace assignment coach. Every authenticated BIG TUNA user gets a fully isolated workspace — no user can see another user's credentials, assignments, runs, or coaching. There is **no admin role**: each API request is scoped to the authenticated user's own id (`data/assignments/users/{userId}/`). The workflow must remain an academic-support tool: summaries, deliverables, outlines, work plans, questions, and quality checklists only. Do not change it into a final-answer generator or automatic coursework submission workflow.

### First-run onboarding

On first visit (no saved config) the app shows a setup form collecting: Brightspace home/landing URL, optional login URL, Brightspace username + password, notification email, which courses to track (auto-pinned or an explicit list of course URLs), a due window, and a "send me a coaching email every morning" toggle. The password is encrypted at rest (AES-256-GCM; key from `ASSIGNMENTS_CRYPTO_SECRET` / `MCP_SECRET` / a gitignored `data/assignments/.cryptokey`) and is never returned to the client.

### How it works

- **Login:** the scraper logs into Brightspace headlessly using the user's stored credentials (fills username/password across frames, handles two-step SSO, detects MFA and degrades to a clear `login-required` status). Each user has a persistent browser profile so sessions are reused. Browser launches are serialised (one at a time) to bound server load.
- **Discovery:** course discovery is browser-bot based. In pinned mode it opens the Brightspace course selector and checks only pinned courses (including `d2l-*` shadow DOM), scanning each course's Assignments/Dropbox section. In list mode it scrapes exactly the course URLs the user configured.
- **Coaching:** generated with the Anthropic Messages API using Claude Opus 4.8 (`ANTHROPIC_MODEL` override), adaptive thinking, academic-support system prompt.
- **Email:** a daily morning scheduler (default 06:00 local, `ASSIGNMENTS_DAILY_HOUR`) runs each enabled+configured user's check and emails them one coaching digest covering assignments due within their window, with per-assignment YES / NO / NEVER action links. Links are HMAC-signed **and bound to the user id**, so one user's link can never touch another user's data.

Per-user data layout under `data/assignments/` (whole directory gitignored):

```text
data/assignments/users/{userId}/config.json   (enabled, urls, username, encrypted credential, email, courses, window)
data/assignments/users/{userId}/state.json    (tracked assignments + run history)
data/assignments/users/{userId}/profile/       (persistent browser profile)
data/assignments/scheduler.json                (daily-run bookkeeping)
data/assignments/.cryptokey                     (generated AES key when no env secret)
```

Routes (all require `Authorization: Bearer <token>` except `/action`, which is HMAC-verified):

```text
GET    /api/assignments                 dashboard data for the current user
GET    /api/assignments/config          current user's setup status (no secrets)
POST   /api/assignments/config          save onboarding / settings
DELETE /api/assignments/config          wipe the current user's assignment data
POST   /api/assignments/check-now       manual scrape (body {email:true} also sends the digest)
POST   /api/assignments/email-now       send the coaching digest from current state
POST   /api/assignments/action          signed YES/NO/NEVER email-link action (carries user id)
```

Server configuration is environment-based, shared across users, and must not be committed:

```text
PUBLIC_BASE_URL=https://yannickmorgans.ca
ASSIGNMENTS_DAILY_HOUR=6
ASSIGNMENTS_CRYPTO_SECRET=...        # AES key material for stored credentials (falls back to MCP_SECRET / keyfile)
ASSIGNMENTS_ACTION_SECRET=...        # HMAC secret for action links (falls back to MCP_SECRET / keyfile)
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-8
RESEND_API_KEY=...
ASSIGNMENTS_FROM_EMAIL=...           # verified Resend sender (recipient is each user's own email)
BRIGHTSPACE_MAX_COURSES=30           # optional scraper tuning
BRIGHTSPACE_SETTLE_MS / BRIGHTSPACE_INITIAL_SETTLE_MS / BRIGHTSPACE_HEADLESS / BRIGHTSPACE_ASSIGNMENT_SELECTOR / BRIGHTSPACE_COURSE_LINK_PATTERN / BRIGHTSPACE_ASSIGNMENT_PATHS  # optional
```

Desktop app source:

- `desktop/big-tuna-lights/` contains an Electron macOS menu-bar controller for the Lights API.
- It defaults to `https://yannickmorgans.ca`, logs in through `/api/auth/login`, stores only the returned session token and username in Electron `userData`, and controls `/api/lights` as username `yannick`.
- Its macOS status item uses a template bulb icon plus a text fallback (`●` on, `○` off) so it remains visible on light and dark menu bars; clicking it directly toggles the light and does not open a menu.
- Packaging command: `cd desktop/big-tuna-lights && npm install && npm run package:mac`. This must run on macOS so Electron framework symlinks are preserved. The `.github/workflows/build-lights-mac.yml` workflow builds the unsigned zip and publishes it as the `lights-mac-latest` GitHub Release asset.
- `desktop/big-tuna-weather/` contains the Electron macOS Weather app. It uses NOAA/NWS first for U.S. coordinates and falls back to Open-Meteo when NOAA is unavailable or the location is outside NWS coverage. It stores saved locations and the selected location in Electron `userData/weather.json`, includes a normal Dock/window app plus a macOS tray widget title in the compact `condition temperature wind` style, and needs no BIG TUNA auth. Clicking the tray/menu-bar item opens the weather panel directly instead of an options menu. Packaging command: `cd desktop/big-tuna-weather && npm install && npm run package:mac`; the `.github/workflows/build-weather-mac.yml` workflow builds the unsigned zip and publishes it as the `weather-mac-latest` GitHub Release asset.
- `desktop/big-tuna-codex/` contains an Electron macOS launcher that opens Terminal.app, ensures `~/BIG-TUNA` exists by cloning or pulling `https://github.com/yannickbigtuna-dev/BIG-TUNA`, and then starts `codex --cd ~/BIG-TUNA --sandbox danger-full-access --ask-for-approval never`. It requires local `git`, Terminal.app, and the Codex CLI already installed on the Mac. Packaging command: `cd desktop/big-tuna-codex && npm install && npm run package:mac`; the `.github/workflows/build-codex-mac.yml` workflow builds the unsigned universal Monterey-compatible zip and publishes it as the `codex-mac-latest` GitHub Release asset.

iOS app source:

- `ios/big-tuna-lights-widget/` contains an XcodeGen-based SwiftUI iPhone app plus WidgetKit extension for the Lights API.
- Generate the project with `cd ios/big-tuna-lights-widget && xcodegen generate`, then open `BigTunaLights.xcodeproj` in Xcode 15+.
- Deployment target is iOS 17 because the widget uses an interactive App Intent button.
- Both the app and widget use App Group `group.ca.yannickmorgans.bigtuna.lights` for shared session token and last-known light state.
- The widget should always display current light status from the public `GET /api/lights` endpoint when online, fall back to the cached last-known state when offline, and only enable toggling when the shared signed-in user is `yannick`.

## Data Storage Map

Treat `data/` as live production state. Do not casually rewrite, reformat, delete, or commit sensitive data. Prefer documenting schemas and paths rather than reading private values unless needed for a task.

```text
data/users.json
  User accounts.

data/sessions.json
  Active login sessions.

data/settings/{userId}/{appId}.json
  Per-user app settings used by Auth settings helpers and autoSync.

data/appdata/{appId}/{userId}.json
  Generic per-user app data store.

data/climbs/{userId}/c_{id}.json
data/climbs/{userId}/s_{id}.json
  Climb tracker v1 per-item JSON files. Soft deletes use _deleted tombstones.

data/climb-tracker/{userId}/sessions.txt
data/climb-tracker/{userId}/climbs/{id}.txt
data/climb-tracker/{userId}/photos/{id}.jpg
  Climb tracker v2 text/photo storage.

data/meets/{userId}.json
  Psych sheet saved meets.

data/quizzes/{userId}/{quizId}.json
  Quiz app data.

data/shared-lists/{id}.json
  Shared list documents with owner/member metadata and list content.

data/lights/state.json
  Desired light relay state for the Lights app and ESP8266 polling integration:
  { on: boolean, updatedAt: ISO string, updatedBy: username or "device" }.

data/lights/device-status.json
  ESP8266 polling heartbeat/status written by the device endpoints:
  { on: boolean, receivedAt: ISO string, polledAt: ISO string }.

data/radar/yhz-YYYY-MM-DD.json
  Daily Halifax local-time set of unique ADSB aircraft IDs seen by the public YHZ radar endpoint, stored as a JSON array.

data/assignments/users/{userId}/config.json
  Per-user assignment coach config: enabled flag, Brightspace URLs, username, AES-256-GCM-encrypted password, notification email, course list/mode, due window. Never committed (the whole data/assignments/ tree is gitignored).
data/assignments/users/{userId}/state.json
  Per-user tracked assignments, attempts/coaching, statuses, and recent run summaries.
data/assignments/users/{userId}/profile/
  Per-user persistent Brightspace browser profile (session reuse).
```

Legacy migrations exist in `server.js` for older `data/settings.json` and single-file climbs. Do not remove migration code unless all production data has been verified and backed up.

## API Surface

All API routes are in `server.js` inside `handleAPI(req, res, urlPath)`.

Authenticated settings and generic data:

```text
GET/POST /api/settings/:appId
GET/POST /api/data/:appId
```

Assignment coach:

```text
GET    /api/assignments
GET    /api/assignments/config
POST   /api/assignments/config
DELETE /api/assignments/config
POST   /api/assignments/check-now
POST   /api/assignments/email-now
POST   /api/assignments/action
```

Climbs v1:

```text
GET/POST /api/climbs
```

Climbs v2:

```text
GET/POST        /api/climbs2
GET             /api/climbs2/photo/:id?t=<token>
POST/DELETE     /api/climbs2/photo/:id
```

Quiz app:

```text
GET/POST        /api/quizzes
GET/PUT/DELETE  /api/quizzes/:id
```

Psych sheet:

```text
GET/POST        /api/meets/psych-sheet
GET/PATCH/DELETE /api/meets/psych-sheet/:id
```

Shared lists:

```text
GET/POST        /api/shared-lists
GET/POST/DELETE /api/shared-lists/:id
GET             /api/shared-lists/:id/events?t=<token>
GET             /api/users/lookup?username=<name>
```

Lights:

```text
GET  /api/lights
POST /api/lights
GET  /api/lights/events
GET  /api/lights/device
GET/POST /api/lights/device/status
```

`GET /api/lights` is public and returns `{ on, updatedAt }`. `GET /api/lights/events` is a public Server-Sent Events stream that immediately emits the same desired state payload whenever it changes. `POST /api/lights` requires bearer session auth and only username `yannick` can update `{ on: boolean }`. Device routes are public and intended for ESP8266 polling/status. `GET /api/lights/device` records `polledAt`, currently returns the inverted stored `on` value as a hardware-polarity workaround, and includes an additive `pollAfterMs` hint, currently `250`, so ESP firmware can poll aggressively without hardcoding the cadence. `GET /api/lights/device/status` returns `{ on, receivedAt, polledAt, recentlyPolled, recentWindowMs }` for the Lights page device-poll indicator.

Radar:

```text
GET /api/radar/yhz
```

`GET /api/radar/yhz` is public for an ESP8266 Halifax aircraft radar display. It fetches ADSB.lol around the configured Halifax center (`44.6392425,-63.5944923`, upstream `dist/55` nautical miles), filters to `rangeKm <= 100`, computes distance/bearing from that center, sorts closest first, returns at most 8 aircraft, caches upstream data in memory for about 12 seconds, and returns HTTP 200 JSON with CORS `Access-Control-Allow-Origin: *`. The response uses schema string `halifax-radar-v1`, `api: "ADSB"`, `message: "data ok"` when online, and `status: "error"`, `message: "api not working"`, and empty `aircraft` when ADSB.lol fails. `planesTracked` counts all filtered aircraft, while `planesToday` comes from `data/radar/yhz-YYYY-MM-DD.json` in Halifax local time.

External/proxy/parser endpoints:

```text
GET  /api/waquatics/search?name=<name>
GET  /api/waquatics/athlete?id=<id>
POST /api/parse-pbest
```

Terminal:

```text
WebSocket /terminal/ws?t=<token>&cols=<n>&rows=<n>
```

Eco AI:

```text
GET  /api/eco-ai/status
POST /api/eco-ai/chat
```

`eco-ai` is an authenticated local-first chat app at `/eco-ai/`. It proxies chat requests from the BIG TUNA Node server to a local Ollama HTTP server on the same machine, using `OLLAMA_BASE_URL` when set or `http://127.0.0.1:11434` by default. `GET /api/eco-ai/status` reports Ollama availability, installed models, a recommended installed model, and file/message limits for the UI. `POST /api/eco-ai/chat` streams newline-delimited JSON events (`meta`, `delta`, `error`, `done`) back to the browser while forwarding the conversation to Ollama `/api/chat`. While the model is still processing it also emits periodic `{"type":"ping"}` keepalive lines (every 15s) so the Cloudflare Tunnel does not idle-drop long generations on large/old chats; clients must ignore unknown event types. The app persists per-user chats in `data/appdata/eco-ai/{userId}.json` and settings in `data/settings/{userId}/eco-ai.json`. File attachments are browser-read text/code snippets included in prompt context; binary and vision features are intentionally not supported yet.

Only username `yannick` is allowed to open terminal WebSocket sessions. The server caps terminal sessions at 5. Each session forks `pty-worker.js`, so a PTY crash should not crash the main server.

## App Notes

`list-maker`:

- Uses `/api/data/list-maker` for personal list state.
- Uses shared-list APIs for collaborative lists.
- Uses `EventSource` on `/api/shared-lists/:id/events?t=...` for live updates.
- Persists last selected list in `localStorage`.
- Registers `Auth.beforeLogout(saveData)`.

`quiz-app`:

- Uses `/api/quizzes`.
- List endpoints return metadata; individual quiz endpoint returns questions.

`psych-sheet`:

- Uses `/api/meets/psych-sheet`.
- Uses `Auth.saveSettings('psych-sheet', ...)` for scoring/settings.

`workout-timer`:

- Uses `Auth.saveSettings('workout-timer', ...)` and `Auth.loadSettings('workout-timer')`.

`climb-tracker`:

- Authenticated static app at `/climb-tracker/`.
- Uses `/api/climbs2` for sessions and climb metadata, and `/api/climbs2/photo/:id` for per-climb JPEG photos.
- Client compresses selected camera/library images to JPEG data URLs before upload.
- Active sessions are represented by entries in the existing `sessions` array with empty `endedAt`; climb records link to sessions through `sessionId`.

`capitals-quiz` and `world-map`:

- Use `Auth.loadSettings(...)` and `Auth.autoSync(...)`.
- Keep localStorage fallback data under app-specific keys.
- Manipulate the topbar title and left slot for navigation.
- `capitals-quiz` settings include region, question count, time limit, difficulty (`easy` 50-capital pool, `medium` 100-capital pool, `hard` all capitals), and training toggles for capital-location dots and reveal-letter hints. The outline renderer draws only the largest polygon for multipolygon countries so detached colonies/islands do not dominate the prompt. The capital dot overlay uses the existing D3/topojson outline projection and fetches capital coordinates from REST Countries with a few local overrides.

`pace-calculator`:

- Uses World Aquatics proxy endpoints.
- Uses `/api/parse-pbest` for PDF/personal-best parsing.

`terminal`:

- Requires auth and connects to `/terminal/ws`.
- Server additionally restricts access to username `yannick`.
- The homepage downloads menu links the unsigned macOS launcher zip at `https://github.com/yannickbigtuna-dev/BIG-TUNA/releases/download/codex-mac-latest/big-tuna-codex-mac.zip`. The app only launches Terminal.app and keeps the real Codex session in a standard terminal window against `~/BIG-TUNA`.

`eco-ai`:

- Authenticated static app at `/eco-ai/`.
- Uses `topbar.js` and `auth.js`.
- Uses `/api/eco-ai/status` to detect whether local Ollama is reachable and which models are installed.
- Uses `/api/eco-ai/chat` for streaming local chat completions proxied to Ollama. The stream is newline-delimited JSON and should surface upstream errors plus `done.empty` when Ollama returns no text so the UI never shows an empty assistant response. Unknown event types (e.g. `ping` keepalives) are ignored by the client.
- Generation is non-destructive: a failed request never persists an error as an assistant turn (the empty placeholder is dropped and a transient toast with a Retry action is shown instead), transient network failures auto-retry up to 3x before nothing has streamed, a failed regenerate restores the previous answer, and previously-saved error/empty assistant turns are pruned on load. Saves to `/api/data/eco-ai` retry and also flush on tab hide/`pagehide`.
- Persists conversation history in `/api/data/eco-ai` and user preferences in `Auth.saveSettings('eco-ai', ...)`.
- Supports multiple saved chats, simple mode presets (`general`, `coding`, `writing`, `study`, `summarize`, `file-analyst`), shorthand model switching with Auto as the default, and browser-read text/code file attachments that are appended to prompt context.
- The intended deployment is a local Ollama install on the website host machine. If Ollama is missing or offline, the UI should show a setup/offline message rather than failing silently.
- `eco-ai-models.txt` is the model maintenance manifest. `maintain-eco-ai-models.ps1` locates Ollama, starts its API if needed, and pulls every nonblank/noncomment model in that manifest. `setup-eco-ai-models.ps1` installs Ollama with `winget` if absent, runs maintenance immediately, and registers a current-user daily 7:00 AM task with missed-start recovery.
- The current Windows host sets the user environment variable `OLLAMA_LLM_LIBRARY=cpu_avx2`. Ollama 0.30.6 generation crashes against the installed NVIDIA 546.17 driver with `CUDA error: device kernel image is invalid`; keep the CPU override until the GPU driver/runtime combination has been upgraded and validated.

`lights`:

- Public static app at `/lights/`.
- Does not load `auth.js`, because the page must remain publicly viewable without showing the login modal.
- Includes its own lightweight inline sign-in/logout controls that write the same `localStorage` auth keys as the rest of the site, so iPhone Safari and Add-to-Home-Screen installs can control the light without needing another app page to establish login first.
- Reads `/api/lights` for state, inverts that API value client-side to match the Arduino-driven physical light state, and posts the inverse value back when toggled. The page enables toggling only when localStorage contains username `yannick`; the server enforces the same rule on `POST /api/lights`.
- Uses `/api/lights/events` SSE for near-instant same-page updates across open browsers, with 1-second `/api/lights` polling only as a fallback.
- Shows a small device-poll indicator based on whether `/api/lights/device` has been called in the last 5 seconds.
- Supports iPhone home-screen installation with Apple web-app meta tags and hides the shared topbar when launched in standalone display mode.
- ESP8266 relay integration should poll `/api/lights/device`, respect the returned `pollAfterMs` hint when practical, apply the returned `on` value, and keep last known relay state if the website is temporarily unreachable. The device endpoint currently inverts the stored website state before returning `on` to work around reversed relay behavior.
- The unsigned macOS desktop controller zip is linked from the homepage downloads menu at `https://github.com/yannickbigtuna-dev/BIG-TUNA/releases/download/lights-mac-latest/big-tuna-lights-mac.zip`. The app zip is too large for GitHub's normal per-file repository limit, so it is hosted as a release asset rather than committed under `apps/`.

`weather`:

- Public static app at `/weather/`.
- Does not load `topbar.js`; it is intentionally styled as a standalone Monterey-style macOS window to match the provided design references.
- Uses Open-Meteo forecast and geocoding APIs directly from the browser; no API key or BIG TUNA auth is required.
- Uses browser geolocation on first load when available, otherwise falls back to Halifax. Saved searched cities and last selected location are stored in `localStorage` under `weather_locations` and `weather_last_location`.
- The website version renders only the Monterey-style main weather window: translucent panel, saved-location sidebar, current temperature, metric cards, hourly strip, and 7-day forecast rows. Current wind is shown as a compass-style heading ring with a thin arrow whose size scales with wind speed and whose shaft originates from the dial center; clicking it opens the embedded wind detail. The metric cards include precipitation in mm/hr instead of wind, but that card switches to current UV index when precipitation is zero. Metric cards open one at a time into a dedicated glass detail area below the metric row so the compact cards never stretch into empty placeholders; hourly forecast items and 7-day rows can also be toggled, with only one hourly detail and one daily detail open at a time. Hourly details stack under the hourly strip, and daily details expand inside the selected day rows. Detail panels and top metric cards slide open and closed smoothly with a slower expansion curve, and closing one panel should not replay other open panel animations or shift metric icons before the close completes. Hourly left/right arrows scroll the hourly strip even while details are open. Time-based metric charts use regular reference lines and tick labels, but do not show axis titles or label each point value. Weather data source selection is internal and uses Auto Best: NOAA/NWS for US locations when available, otherwise Open-Meteo fallback. The macOS menu bar widget is only in `desktop/big-tuna-weather/`.
- The homepage downloads menu links the unsigned macOS zip at `https://github.com/yannickbigtuna-dev/BIG-TUNA/releases/download/weather-mac-latest/big-tuna-weather-mac.zip`.

## Coding Standards

General:

- Keep changes narrowly scoped. This is a live site.
- Default orchestration for non-trivial work is architect spec -> cheaper sub-agent implementation -> top-level validation/testing -> repeat until the spec passes.
- The architect spec should define scope, constraints, implementation approach, and concrete acceptance checks that the final validation pass can execute.
- Prefer existing plain Node and vanilla browser JavaScript patterns.
- Do not introduce a framework, build step, transpiler, or database unless explicitly requested.
- Use CommonJS in the root server and ES modules inside `mcp-server/`.
- Keep files browser-served and dependency-free unless there is a clear reason.
- Preserve existing user data formats and migrations.
- Use atomic writes for durable JSON state.
- Validate IDs before using them in paths.
- Avoid logging secrets, tokens, passwords, or raw private user data.
- Avoid committing generated logs, `node_modules`, local credentials, token files, `.env`, `.cache`, `dist`, or `build`.

Frontend:

- Link `/styles/tokens.css` in `<head>` and style every element with `var(--…)` tokens — no hardcoded hex, radius, or shadow values. See `ARCHITECTURE.md`.
- Load `topbar.js` before `auth.js` for authenticated apps.
- Prefer the shared glass-surface primitives and tokenized accent system over app-local styling. If an app needs a distinct accent, override `--accent` from the shared token ramp instead of introducing raw colors.
- Gate authenticated app startup with `Auth.onReady`.
- Use `Auth` helpers for per-user settings when possible.
- For app data that outgrows settings, use `/api/data/:appId` or a dedicated route.
- Keep mobile/responsive behavior in mind; many apps are single-file HTML/CSS/JS.
- Update homepage and topbar app lists when adding/removing apps.

Server/API:

- Add routes in `handleAPI`.
- Parse JSON request bodies with existing `parseBody(req)`.
- Return JSON through `jsonRes(res, status, data)`.
- Keep route ordering specific before broad dynamic routes.
- Use bearer auth through `getToken(req)` and `getSessionUser(token)` unless the endpoint is intentionally public.
- For browser APIs that cannot send headers, query token `t` is an established pattern, but use it sparingly.

## Documentation Maintenance

Update this file whenever a change would affect future Codex decisions, especially:

- New app, removed app, or renamed app.
- New API route or changed request/response behavior.
- New data path, schema, migration, or persistence rule.
- New dependency, script, service, port, hostname, or deployment path.
- Changed auth/security rule.
- Changed coding or UI convention.
- Changed live deployment workflow.

Small visual copy edits or isolated bug fixes usually do not need a context update unless they reveal a durable convention.

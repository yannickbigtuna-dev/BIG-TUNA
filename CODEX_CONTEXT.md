# BIG-TUNA Codex Context

Read this file after `AGENTS.md` at the start of every Codex session. It is the compact project map so Codex does not need to reread the whole repository before making normal changes.

When a change affects architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards, update this file in the same commit.

## Project Purpose

BIG-TUNA is a personal self-hosted website at `yannickmorgans.ca`. It runs on a Windows machine, serves a collection of single-page apps, stores live state in local files under `data/`, and is exposed publicly through Cloudflare Tunnel. The live server auto-pulls from GitHub, so pushes to `main` can affect the live site.

## Mandatory Workflow

1. Run `git pull origin main` before making changes.
2. Inspect only the files needed after reading this context.
3. Make the requested edits.
4. Run `git status` and `git diff`.
5. Do not commit secrets, `.env`, `node_modules`, cache/build junk, or local machine-only files.
6. Commit completed changes with a clear message.
7. Push with `git push origin main`.
8. Tell the user what changed and that it was pushed.

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
+-- cloudflared-config.yml    # Cloudflare Tunnel ingress config
+-- *.bat, *.ps1              # Windows setup/start/helper scripts
```

Important local-machine assumptions: several scripts and log messages still refer to `C:\SERVER`, while this checkout may be `C:\BIG-TUNA`. Be careful before changing paths; deployment scripts may rely on the production path.

## Runtime Architecture

There are two Node servers.

Main server:

- File: `server.js`
- Port: `3000`
- Module system: CommonJS
- Dependencies used directly: Node stdlib, `ws`, `node-pty` through `pty-worker.js`, Puppeteer packages for PDF/parsing-related features.
- Responsibilities: static file serving from `apps/`, all `/api/*` routes, auth/session management, local file persistence, shared-list Server-Sent Events, web terminal WebSocket upgrades.

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

`start-everything.ps1` is the canonical local orchestrator. It starts or restarts PM2 apps `apps-server` and `mcp-server`, saves the PM2 process list, starts `cloudflared.exe` with `cloudflared-config.yml` only when the tunnel process is absent, and starts `auto-update.ps1` hidden when the git reloader is absent. `auto-update.ps1` polls `origin/main` every 10 seconds and pulls newer commits.

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

It creates `data/users.json` and `data/sessions.json` if missing.

Persistence uses `atomicWrite(filePath, data)` for JSON writes: write `file.tmp`, then rename. Preserve this pattern for important JSON state.

User-controlled IDs used in filenames must pass `isValidId(id)`: alphanumeric, underscore, hyphen, length 1-64. Use this or a similarly strict validator for any new file-backed route.

Static serving:

- Static root is `apps/`.
- `/` serves `apps/index.html`.
- `/topbar.js` and `/auth.js` are served from `apps/topbar.js` and `apps/auth.js`.
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
<script src="/topbar.js"></script>
<script src="/auth.js"></script>
<script>
  Topbar.setTitle('My App');
  Auth.onReady(user => {
    // Start app here.
  });
</script>
```

Shared topbar:

- File: `apps/topbar.js`
- Include before `auth.js`.
- APIs: `Topbar.setTitle(title)`, `Topbar.addLeft(element)`.
- It injects a sticky nav with HOME, APPS dropdown, centered title, and `[data-auth-widget]` slot.
- The APPS dropdown list is hardcoded in `topbar.js`; update it when adding/removing visible apps.

Homepage:

- File: `apps/index.html`
- Custom launcher page with clock, weather/temperature widget, and app cards.
- Has a persisted minimal mode toggled by the bottom-left button; minimal mode hides homepage chrome and app cards, leaving BIG TUNA, date, clock, lights link, and the exit button.
- Adding an app may require updating both homepage cards and `topbar.js`, even though the static server can auto-index folders.

Current app folders:

- `apps/capitals-quiz/`
- `apps/list-maker/`
- `apps/lights/`
- `apps/pace-calculator/`
- `apps/psych-sheet/`
- `apps/quiz-app/`
- `apps/terminal/`
- `apps/workout-timer/`
- `apps/world-map/`

Desktop app source:

- `desktop/big-tuna-lights/` contains an Electron macOS menu-bar controller for the Lights API.
- It defaults to `https://yannickmorgans.ca`, logs in through `/api/auth/login`, stores only the returned session token and username in Electron `userData`, and controls `/api/lights` as username `yannick`.
- Its macOS status item uses a template bulb icon so it remains visible on light and dark menu bars; clicking the icon directly toggles the light and does not open a menu.
- Packaging command: `cd desktop/big-tuna-lights && npm install && npm run package:mac`. This must run on macOS so Electron framework symlinks are preserved. The `.github/workflows/build-lights-mac.yml` workflow builds the unsigned zip and publishes it as the `lights-mac-latest` GitHub Release asset.

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
```

Legacy migrations exist in `server.js` for older `data/settings.json` and single-file climbs. Do not remove migration code unless all production data has been verified and backed up.

## API Surface

All API routes are in `server.js` inside `handleAPI(req, res, urlPath)`.

Authenticated settings and generic data:

```text
GET/POST /api/settings/:appId
GET/POST /api/data/:appId
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

`lights`:

- Public static app at `/lights/`.
- Does not load `auth.js`, because the page must remain publicly viewable without showing the login modal.
- Reads `/api/lights` for state and enables toggling only when localStorage contains username `yannick`; the server enforces the same rule on `POST /api/lights`.
- Uses `/api/lights/events` SSE for near-instant same-page updates across open browsers, with 1-second `/api/lights` polling only as a fallback.
- Shows a small device-poll indicator based on whether `/api/lights/device` has been called in the last 5 seconds.
- ESP8266 relay integration should poll `/api/lights/device`, respect the returned `pollAfterMs` hint when practical, apply the returned `on` value, and keep last known relay state if the website is temporarily unreachable. The device endpoint currently inverts the stored website state before returning `on` to work around reversed relay behavior.
- The bottom of the Lights page links to the unsigned macOS desktop controller zip at `https://github.com/yannickbigtuna-dev/BIG-TUNA/releases/download/lights-mac-latest/big-tuna-lights-mac.zip`. The app zip is too large for GitHub's normal per-file repository limit, so it is hosted as a release asset rather than committed under `apps/`.

## Coding Standards

General:

- Keep changes narrowly scoped. This is a live site.
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

- Load `topbar.js` before `auth.js` for authenticated apps.
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

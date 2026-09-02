# BIG-TUNA Codex Context

Read this file after `AGENTS.md` at the start of every Codex session. It is the compact project map so Codex does not need to reread the whole repository before making normal changes.

When a change affects architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards, update this file in the same commit.

## Project Purpose

BIG-TUNA is a personal self-hosted website at `yannickmorgans.ca`. It runs on a Windows machine, serves a collection of single-page apps, stores live state in local files under `data/`, and is exposed publicly through Cloudflare Tunnel. The live server auto-pulls from GitHub, so pushes to `main` can affect the live site.

## Mandatory Workflow

Current user and task restrictions narrow permissions and override conflicting default Git or deployment operations, but do not weaken mandatory safety or coordination requirements; pre-existing modified and untracked files are user-owned and must not be discarded, overwritten, or cleaned.

1. Run `git pull origin main` before making changes.
2. The root thread uses the most capable configured model as architect, coordinator, integration owner, and final reviewer.
3. The architect must inspect only the files needed after reading this context, then produce a thorough pre-code implementation spec covering scope, constraints, ownership, approach, and concrete acceptance checks.
4. That spec must be strong enough to act as the acceptance and testing guide for the final validation pass.
5. Send independent, disjoint work packages to project implementer agents in one parallel round whenever practical. Lighter implementers must preserve concurrent work, run focused checks, and never commit or push.
6. Tester agents may run independent validation in parallel where useful.
7. The root must review the actual diff, verify the implementation against the original spec, check for regressions, and decide whether the work is complete.
8. If the work is not good enough, run another implementation pass using the review feedback, then retest until the original spec passes.
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
+-- .codex/config.toml        # Codex root-thread model, permissions, and concurrency configuration
+-- .codex/agents/implementer.toml # Lighter project implementer-agent configuration
+-- .codex/agents/tester.toml # Project tester-agent configuration for independent validation
+-- .codex/skills/*/SKILL.md  # Task-specific Codex procedures
+-- docs/AI-WORKFLOW.md       # Supplemental task routing and FAST/STANDARD/DEEP modes
+-- docs/agents/*.md          # Supplemental specialist role guides
+-- docs/exec-plans/active.md # Shared active plan for broad or deployment/data work
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
- Dependencies used directly: Node stdlib, `ws`, `node-pty` through `pty-worker.js`, Puppeteer packages for PDF/parsing-related features and Brightspace browser automation, `geoip-lite` (offline IP→country/region/city lookup for the analytics beacon, no external network calls).
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

`start-everything.ps1` is the canonical local orchestrator. It starts or restarts PM2 apps `apps-server` and `mcp-server`; every existing `apps-server` restart goes through `ecosystem.config.cjs --only apps-server --update-env` so the gitignored `server.env` is reloaded. It saves the PM2 process list, starts `cloudflared.exe` with `cloudflared-config.yml` only when the tunnel process is absent, and starts `auto-update.ps1` hidden when the git reloader is absent. Before starting the app it configures HomeKit only for the persisted trusted Wi-Fi SSID and creates inbound TCP 51826/UDP 5353 rules limited to the Private profile and LocalSubnet; the profile marker is gitignored under `data/lights/homekit/homekit-network.json`. `auto-update.ps1` polls `origin/main` every 10 seconds, but only pulls/restarts when `origin/main` is a strict fast-forward descendant of local `HEAD`; after each successful pull it runs `npm install --omit=dev --no-audit --no-fund` before restarting `apps-server`, and it leaves the running server untouched when that install fails. A locally-ahead checkout is left running until it is pushed, and divergence is reported without repeated restart attempts.

`start-everything.ps1` now also makes a best-effort, non-blocking attempt to start the local Ollama API before the rest of the stack so Eco AI is ready sooner after boot. It persists and exports `OLLAMA_LLM_LIBRARY=cpu_avx2` before startup and restarts an unhealthy/stale Ollama process on that backend; `maintain-eco-ai-models.ps1` applies the same rule.

There is no build step. Frontend files in `apps/` are served directly. Restart Node after changing `server.js` or `pty-worker.js`.

`npm test` runs the Node test suite (`node --test`), including Assignment Coach and Trivia generator coverage.

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
- `data/analytics/events/`
- `data/email/templates/`
- `data/email/campaigns/`

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

- Users live in `data/users.json`. Each user optionally carries an `email` field (nullable) used only for password-reset delivery — it is not required at registration and is not shown to other users.
- Sessions live in `data/sessions.json`.
- Sessions are bearer tokens with 30-day expiry.
- Passwords are SHA-256 with per-user random salt, not bcrypt.
- `writeSessions()` prunes expired sessions on write.
- Password-reset tokens live in `data/password-resets.json`: `{ token, userId, createdAt, expiresAt }`, 1-hour TTL, pruned on write via `writePasswordResets()` (same prune-on-write pattern as sessions). A reset token is single-use and is deleted the moment it's redeemed; redeeming one also invalidates every existing session for that user (`writeSessions(sessions.filter(s => s.userId !== user.id))`), forcing re-login everywhere.
- Frontend token and user cache are in `localStorage` keys `auth_token` and `auth_user` (the cached user object now also carries `email`).
- 2026-07: `data/users.json` was accidentally emptied on the live server after it was removed from git tracking (commit "Stop tracking data/..."); 4 accounts were restored from the last git-tracked snapshot (exact id/username/passwordHash/salt reinstated so original passwords still work), and one account's orphaned app data was merged into the current active account by user id. A 6th account's data is still orphaned under its old user id (no username/password was ever recoverable) — do not delete that orphaned data without checking with the user first, in case its owner is later identified.

Shared auth client:

- File: `apps/auth.js`
- Include with `<script src="/auth.js"></script>`.
- Use `Auth.onReady(callback)` before starting app behavior that needs a user.
- `Auth.token` and `Auth.user` expose current auth state (`Auth.user.email` may be `null`).
- `Auth.saveSettings(appId, data)` and `Auth.loadSettings(appId)` use `/api/settings/:appId`.
- `Auth.autoSync(appId, getDataFn, options)` periodically saves settings, retries failures, saves before logout, and attempts `keepalive` before unload.
- `Auth.beforeLogout(fn)` lets apps flush state.
- The login modal has a "Forgot password?" link (login mode only) that switches the same modal into a username-only "forgot" mode and posts to `/api/auth/forgot-password`; the response is always `{ok:true}` regardless of whether the account/email exists, to avoid username enumeration.
- The account dropdown (in `injectWidget()`) has an inline recovery-email row (`#auth-dd-email-input` + `#auth-dd-email-save`) that calls `/api/auth/set-email`; the dropdown's own click handler calls `stopPropagation()` so interacting with the input doesn't close the dropdown via the document-level close handler.
- `init()` checks `location.search` for `?resetToken=` before anything else; if present it strips the param (`history.replaceState`) and shows a dedicated `showResetModal(token)` new-password form that posts to `/api/auth/reset-password`, taking priority over the normal cached-login/app-ready flow.

Auth routes:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/set-email        { email }              (authenticated; email:'' clears it)
POST /api/auth/forgot-password  { username }            (public; always returns {ok:true})
POST /api/auth/reset-password   { token, password }     (public; single-use token, invalidates existing sessions)
POST /api/account/test-email                            (authenticated; TEMP — sends a test email to the caller's own address to confirm Resend delivery, remove once confirmed)
```

Password-reset/test emails reuse the Resend `sendEmail(to, {subject, text, html, from})` helper from `lib/assignment-coach.js` (now exported and given an optional `from` override), which no-ops with `{skipped:true, reason}` when `RESEND_API_KEY` or a sender address isn't available — the same `RESEND_API_KEY` used by the Assignment Coach digest emails, no new credentials needed. Account/reset emails pass `from: ACCOUNT_EMAIL_FROM` (`server.js`, currently `no-reply@yannickmorgans.ca`) so they're distinct from the Assignment Coach's own `ASSIGNMENTS_FROM_EMAIL` sender; `sendEmail()` falls back to `ASSIGNMENTS_FROM_EMAIL` when no `from` is passed, so existing Assignment Coach call sites are unaffected. The reset link is built from `PUBLIC_BASE_URL` (or `https://yannickmorgans.ca`) plus `/?resetToken=<token>`, handled entirely client-side by `auth.js` on any page since every app loads it.

The former temporary "send test email" corner-tools button was removed once Resend delivery was confirmed; that same homepage corner-tools slot (`#admin-dashboard-btn`, `apps/index.html`, next to the Lights button) now links to `/admin/` instead, hidden until `Auth.onReady` fires for the `yannick` account specifically (same convention as `/api/lights` and the terminal WebSocket). This is a second, homepage-level entry point to the admin dashboard alongside the hidden dropdown link in `apps/auth.js`'s account widget — see "Admin Dashboard & Email Campaigns" above. `POST /api/account/test-email` still exists server-side (harmless, still yannick-gated) but nothing in the UI calls it anymore.

**Gotcha:** code outside `auth.js` must reference the global `Auth` identifier directly (`typeof Auth !== 'undefined'`), never `window.Auth` — `const Auth = (() => {...})()` at a classic `<script>`'s top level is a global lexical binding, not a `window` property, so `window.Auth` is always `undefined` and silently short-circuits any code gated on it. `apps/index.html`'s two `Auth.onReady(...)` call sites were fixed to check `Auth` directly; `apps/capitals-quiz/index.html` and `apps/world-map/index.html` still guard their `Auth.loadSettings`/`Auth`-dependent code with `window.Auth` and are very likely hitting the same silent no-op (unverified — flagged, not yet fixed).

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
- APIs: `Topbar.setTitle(title)`, `Topbar.addLeft(element)`, `Topbar.identify(user, token)` (called by `auth.js` whenever `_user` is set/refreshed — feeds the site-wide analytics beacon; see "Admin Dashboard & Email Campaigns").
- It injects a sticky nav with HOME, APPS dropdown, centered title, and `[data-auth-widget]` slot.
- It also hosts a lightweight tracking beacon (pageview/heartbeat/click → `POST /api/analytics/event`) since it's the one file loaded on nearly every app — see "Admin Dashboard & Email Campaigns" for the full behavior and privacy notes.
- It also applies the route-specific accent override early on load so each app can inherit its assigned shared-token tint.
- **Accent = homepage tile color (required):** the `color` set for an app in `topbar.js` (its in-app `--accent`) MUST be the same rainbow token as that app's tile/icon on the homepage grid (`apps/index.html`, the `--tile` on its `.card`). When adding a new app, pick one rainbow token and use it in both places so the launcher tile and the app's interior share one identity. (Example: Trivia is `--c-yellow` on the homepage tile and as its route accent.)
- The APPS dropdown list is hardcoded in `topbar.js`; update it when adding/removing visible apps.

Homepage:

- File: `apps/index.html`
- Custom launcher page with clock, weather/temperature widget, an Ask Emma assistant bar, and app cards.
- The launcher uses a glass top nav, a 3-column rainbow-tinted app grid, bottom-right corner utility buttons, and a pointer-following ambient background on fine-pointer devices.
- Hero layout (top to bottom): the large glowing coral "BIG TUNA" wordmark, the uppercase date line, then a digit-slot clock (HH:MM:SS) whose seconds digits glow coral and whose digits roll on change. Clock digits use Geist (tabular numerals), not mono.
- Top nav: left holds the `[data-auth-widget]` account slot (auth.js fills it); right shows only the Open-Meteo "feels like" temperature (no nav clock in this layout).
- "Ask Emma" prompt bar (the Eco AI assistant): a glass input below the clock with a coral sparkle icon (no keyboard shortcut). Submitting navigates to `/eco-ai/`, passing the typed text as `?q=`; Eco AI then opens a fresh chat and auto-sends that exact prompt (see the `eco-ai` notes below). This bar replaces the former Eco AI grid tile, so the grid has 9 tiles (Climb Tracker, Workout Timer, Trivia, Psych Sheet, Lists, Assignments, World Map, Pace Calculator, Capitals Quiz) and Eco AI is reached via the bar. The Trivia tile replaced the former Quizzes tile; the `quiz-app` still exists and is reachable via the topbar APPS dropdown.
- The homepage never scrolls: `body` is locked to the viewport height (`100svh`, `overflow: hidden`) and a `fitStage()` routine measures the `.stage` and applies a uniform `transform: scale(...)` (≤1) so the clock, Ask Emma bar, and app tiles shrink together to fit any screen size/orientation. It re-runs on `resize`, `orientationchange`, `load`, `document.fonts.ready`, and once the auth account pill is injected (`Auth.onReady`).
  - Mobile-overlap correctness: `fitStage()` measures available height from `document.body.clientHeight` (the padded `100svh` box) — **not** `window.innerHeight`, which on iOS Safari reports the taller toolbar-hidden viewport and would leave the scaled stage bleeding past the padding into the fixed bars. A companion `reserveBars()` sets `body` top/bottom padding to the *measured* `#topnav`/`.corner-tools` heights (which already include their safe-area-inset padding) plus a 12px gap, so the stage can never sit under a bar on any device. The scale also trims 0.5px to absorb sub-pixel rounding.
  - The top-nav account pill (left) is allowed to shrink and truncate a long username with an ellipsis (`min-width:0` + `text-overflow: ellipsis`) so it never overlaps the temperature widget on the right.
- Tiles show a colored icon chip plus a label on desktop; on screens ≤600px the labels are hidden (icon-only, per the mobile design) with the accessible name kept on each tile's `aria-label`.
- Bottom-right corner has two glass circular icon buttons: Downloads (opens the release-asset menu for the Lights app, Weather app, and the BIG TUNA Codex macOS launcher) and a lightbulb link to `/lights/`.
- The visual direction comes from the Stitch "Spectrum App Hub" project (desktop screen `a6ae5e90dae6418981b6bfeb74763396`, mobile screen `f6e7cd0a654448c39a5ba09c5e811a8a`); reference screenshots are saved at `docs/design/homepage-desktop-reference.png` and `docs/design/homepage-mobile-reference.png`. The page is hand-rebuilt natively (no Tailwind/CDN) on `/styles/tokens.css` so all live behaviour and conventions are preserved.
- Note: the previous persisted minimal-mode toggle was removed because this design has no control for it.
- The top-right homepage weather widget links to `/weather/` and displays Open-Meteo apparent temperature. It tries browser geolocation first and falls back to Halifax coordinates (`44.6488,-63.5752`) when geolocation is denied, unavailable, times out, or the first weather request fails.
- Adding an app may require updating both homepage cards and `topbar.js`, even though the static server can auto-index folders.

Current app folders:

- `apps/admin/` (yannick-only, not on the homepage grid or topbar APPS dropdown — see "Admin Dashboard & Email Campaigns")
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
- `apps/trivia/`
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

- `ios/big-tuna-lights-widget/` is the deterministic XcodeGen product source for the BIG TUNA Lights Apple family: native iPhone app, `.systemSmall` interactive Home Screen widget, iOS control, companion Watch app, Watch complications/Smart Stack widget, and watchOS control.
- Its durable identity/capability contract is `ios/app-factory/specs/big-tuna-lights.yml`; generate it through Apple App Factory or run `cd ios/big-tuna-lights-widget && xcodegen generate`, then open `BigTunaLights.xcodeproj` in Xcode 26+.
- The full feature set targets iOS 18 and watchOS 26. iPhone controls use the existing iPhone widget extension ID; Watch controls use the Watch widget extension ID, so no extra control App IDs are introduced.
- All four app/extension targets use App Group `group.ca.yannickmorgans.bigtuna.lights` for a revocable, Lights-only bearer token and last confirmed native state. Login briefly uses a normal website session, exchanges it through `POST /api/lights/native/v1/session`, then revokes the website session; passwords are never persisted. The iPhone sends the scoped token/state application context to the Watch with WatchConnectivity.
- Native surfaces use owner-authenticated `GET/PUT /api/lights/native/v1`, explicit physical target state, and an idempotent command ID. They never optimistically cache an unconfirmed change. The website, HomeKit, scheduler, and ESP routes retain their prior stored/inverted contracts.
- The app uses the Lights page's physical wall-plate/paddle visual, upper owner-access screw, and lower relay-heartbeat screw. The Home Screen widget is Apple's smallest supported square family; there is no app-icon-sized 1x1 Home Screen WidgetKit family, so the 1x1 experience is the system control.

## Admin Dashboard & Email Campaigns

`/admin/` is a real usage-analytics dashboard and email campaign suite, restricted to the site owner only. There is no general admin role — every gate is the same one-off check already used elsewhere in this codebase: `user.username.toLowerCase() === 'yannick'` (see the `/api/lights` POST gate and the former `/api/account/test-email` gate). It is **not** listed in `topbar.js`'s `APPS` array or on the homepage tile grid — both are hardcoded lists, and simply never adding an entry keeps `/admin/` invisible to every other user; the only discovery path is a hidden "Admin Dashboard" link injected into the account dropdown (`apps/auth.js`, `#auth-dd-admin-link`) that only becomes visible for the `yannick` account, exactly like the account dropdown's existing patterns. The client-side gate (and the hidden link) are UX niceties only — the real security boundary is that every `/api/admin/*` route re-checks the same condition server-side and 403s otherwise, so the page must degrade to a plain "not authorized" state rather than assume the client check is sufficient.

Given this is a ~40-user personal/family site rather than a SaaS product, every number shown is computed from real activity — there is intentionally no revenue, churn, conversion-rate, cohort-retention, or fake audience-segment concept anywhere in this feature.

### Site-wide tracking beacon

`apps/topbar.js` (loaded on nearly every app) hosts a lightweight analytics beacon so no per-app changes were needed. It exposes a new public method, `Topbar.identify(user, token)`, called by `apps/auth.js` every time `_user` is set/refreshed — `token` is carried because `navigator.sendBeacon` cannot set custom headers, so the bearer token rides in the JSON body instead and `POST /api/analytics/event` falls back to a body-supplied `token` when no `Authorization` header is present (`getSessionUser(getToken(req) || body.token)`). Without this fallback every beacon would resolve to `userId: null` regardless of login state.

Behavior:
- A `sessionStorage`-persisted `bt_session_id` (per-tab, cleared on tab close — matches this codebase's full-page-load reality rather than a real SPA session).
- A `pageview` beacon fires on `Topbar.identify()` or a ~300ms timeout, whichever comes first (so pages that don't load `auth.js` still get an anonymous pageview instead of losing it).
- A `heartbeat` every 15s, skipped while `document.visibilityState !== 'visible'`.
- A capture-phase `click` listener, throttled to ~1/150ms, recording only `{tag, id, first class, text trimmed to 40 chars}` of the nearest `button/a/[role=button]` ancestor plus `xPct`/`yPct` (click position as % of viewport). Explicitly never captures keystrokes, form values, or full DOM selectors.
- Geo enhancement is opportunistic and never prompts: it calls `navigator.permissions.query({name:'geolocation'})` and only calls `navigator.geolocation.getCurrentPosition` when that already reports `'granted'` (e.g. because the user previously allowed it for the Weather app) — a fresh permission prompt is never triggered purely for analytics. When available, `lat`/`lon` are attached to the next beacon; `country`/`region`/`city` are always resolved server-side from the request IP via `geoip-lite` regardless, so the aggregate dashboard always has geography even without browser geolocation.
- Transport is `navigator.sendBeacon`, falling back to `fetch(..., {keepalive:true})`.
- **Coverage gap**: `lights` and `weather` don't load `topbar.js` at all (by design — see their App Notes), so they are not tracked. Acceptable: both are single-purpose, chrome-free micro-apps.

`POST /api/analytics/event` (public, unauthenticated) validates `type` ∈ `{pageview, heartbeat, click}`, caps the body at 4KB, applies a naive in-memory per-IP rate limit (~60/min, self-pruning `Map`), resolves geo (`geoip-lite`) and device (`mobile|tablet|desktop` via UA regex) server-side, and appends one line to `data/analytics/events/{YYYY-MM-DD}.ndjson`. No raw IP is ever persisted — it's resolved to `country`/`region`/`city` at ingest and discarded.

**NDJSON is an intentional, documented deviation from the `atomicWrite` convention** — events are high-frequency, low-value-per-record, so `fs.appendFileSync` (O(1)) is used instead of rewriting a JSON array with `atomicWrite` (O(n) per event). At this site's scale this is a few KB/day; there is no rotation/retention logic and none is needed. Do not "fix" this into a heavier structure without re-litigating the tradeoff.

Admin-only read endpoints aggregate directly from the NDJSON logs at request time (no separate rollup table): `/api/admin/overview` (KPIs, daily pageview/session series, geo distribution, device breakdown, recent activity), `/api/admin/users` (per-user aggregate: last seen, session count, pageviews, avg session duration, top app — computed from events, not stored on the user record), `/api/admin/users/:id` (single-user deep dive: recent events, device breakdown, geo locations, any `lat`/`lon` pings), `/api/admin/clicks` (top clicked targets + a click-position point cloud for a lightweight density view).

### Email campaigns

`lib/email-campaigns.js` is a sibling module to `lib/assignment-coach.js` — it reuses that module's `sendEmail` (unmodified, so the existing password-reset/digest paths can't regress) and its HMAC `signAction`/`verifyAction` pair (note: `signAction` is only exported nested under assignment-coach's `_test` sub-object, not top-level — `email-campaigns.js` imports it from there deliberately, not by mistake) for tamper-proof open/click tracking links.

Both templates and campaigns store a `blocks` array (not just rendered HTML), so the visual editor can re-open and edit them: `{type:'heading',text}`, `{type:'text',html}`, `{type:'button',label,url}`, `{type:'image',src,alt}`, `{type:'divider'}`. `renderCampaignHtml(campaign, recipient)` compiles blocks into email-safe, inline-styled HTML (no external stylesheet — email clients don't load one; mirrors the inline-style conventions already used by `digestHtml()` in `lib/assignment-coach.js`), appends a 1×1 open-tracking pixel, and rewrites every button URL through the signed `/click` redirect endpoint. The admin app's live block editor mirrors this rendering client-side (a lightweight JS equivalent) purely for instant preview — it does not call the server on every keystroke, and preview buttons are not tracking-wrapped since they're never actually sent.

`sendCampaign(campaignId)` resolves `recipientIds` against `data/users.json`, **skips any recipient with no `email` on file** (recorded as `status:'skipped'` in `sendResults`, surfaced in the UI rather than silently under-delivering — email is optional/nullable on this site's user schema), and sends **sequentially** with a ~400ms delay between recipients (fine at this site's scale, avoids Resend rate limits without a concurrency pool). `sendResults[]` is written back incrementally after each send so a mid-send crash doesn't lose progress. A campaign scheduler (`startCampaignScheduler`, wired into `server.listen()` next to `startLightsScheduler()`) copies that same 30s-tick/transition-detection pattern at a 60s interval, picking up `status:'scheduled'` campaigns whose `scheduledAt` has passed, guarded by an in-memory in-flight `Set` so a slow send can't be double-triggered.

**From-address**: `campaign.fromEmail` defaults to `ACCOUNT_EMAIL_FROM` (`no-reply@yannickmorgans.ca`); any value must pass `EMAIL_RE` and end in `@yannickmorgans.ca` — the only Resend-verified sending domain today. This is validated both client-side (immediate feedback) and server-side (the real boundary) on every campaign create/update.

**Test-send safety valve**: `POST /api/admin/email/campaigns/:id/test` always sends exactly one email to the *caller's own* `user.email`, completely ignoring `recipientIds` — this is the only send-adjacent action that's safe to exercise during development/validation. `POST /api/admin/email/campaigns/:id/send` is the real, irreversible bulk send and must never be fired outside of a genuine user-initiated action.

Open/click tracking (`GET /api/admin/email/campaigns/:id/open`, `.../click`) are public routes (hit by the recipient's email client, not a logged-in browser) gated by a signed token (90-day TTL) rather than session auth. `/open` always returns a real 1×1 transparent GIF regardless of signature validity (never a broken image), only recording an open when the signature verifies. `/click` validates the target URL is `http(s)://` only (never `javascript:`/`data:`) and always redirects somewhere safe, only recording a click when the signature verifies.

### Data & API summary

```text
data/analytics/events/{YYYY-MM-DD}.ndjson   one JSON object per line, append-only (see above)
data/email/templates/{id}.json              {id,name,description,category,blocks,subject,createdAt,updatedAt}
data/email/campaigns/{id}.json              {id,name,subject,fromEmail,blocks,templateId,recipientIds,status,
                                              scheduledAt,createdAt,updatedAt,sentAt,sendResults:[{userId,email,
                                              status,error,sentAt,opened,openedAt,clicks:[{ts,url}]}]}
```

```text
POST /api/analytics/event                                   public
GET  /api/admin/overview?range=7|30|90                       yannick-only
GET  /api/admin/users                                        yannick-only
GET  /api/admin/users/:id                                    yannick-only
GET  /api/admin/clicks?path=&range=                          yannick-only
GET/POST        /api/admin/email/templates                   yannick-only
GET/PUT/DELETE  /api/admin/email/templates/:id                yannick-only
GET/POST        /api/admin/email/campaigns                   yannick-only
GET/PUT/DELETE  /api/admin/email/campaigns/:id                 yannick-only
POST /api/admin/email/campaigns/:id/send                     yannick-only (real, irreversible bulk send)
POST /api/admin/email/campaigns/:id/test                     yannick-only (always self-only — safe)
GET  /api/admin/email/campaigns/:id/open?u=&t=                public (signed token)
GET  /api/admin/email/campaigns/:id/click?u=&t=&url=          public (signed token)
```

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
  { on: boolean, updatedAt: ISO string, updatedBy: username or "device",
    revision: non-negative integer }. Older files without `revision` read as 0.

data/lights/device-status.json
  ESP8266 polling heartbeat/status written by the device endpoints:
  legacy `{ on, receivedAt, polledAt }` plus trusted `{ trustedOn,
  trustedReceivedAt, trustedPolledAt }` fields written only when the configured
  `X-Big-Tuna-Device-Token` is valid.

data/lights/native-sessions.json
  Bounded, expiring, Lights-only Apple client bearer tokens.

data/lights/native-commands.json
  Bounded ten-minute native command result journal for restart-safe idempotency.

data/lights/homekit/
  Gitignored HAP-NodeJS pairing identity and a random persistent HomeKit setup
  code for the local BIG TUNA Lights bridge. Back it up with other runtime data;
  deleting it forces Apple Home to pair again.

data/radar/yhz-YYYY-MM-DD.json
  Daily Halifax local-time set of unique ADSB aircraft IDs seen by the public YHZ radar endpoint, stored as a JSON array.

data/assignments/users/{userId}/config.json
  Per-user assignment coach config: enabled flag, Brightspace URLs, username, AES-256-GCM-encrypted password, notification email, course list/mode, due window. Never committed (the whole data/assignments/ tree is gitignored).
data/assignments/users/{userId}/state.json
  Per-user tracked assignments, attempts/coaching, statuses, and recent run summaries.
data/assignments/users/{userId}/profile/
  Per-user persistent Brightspace browser profile (session reuse).

data/analytics/events/{YYYY-MM-DD}.ndjson
  Append-only site-wide tracking beacon log, one JSON object per line. See "Admin Dashboard & Email Campaigns" above for the shape, privacy notes, and why NDJSON (not atomicWrite) is used here on purpose.

data/email/templates/{id}.json
data/email/campaigns/{id}.json
  Email campaign suite templates/campaigns. See "Admin Dashboard & Email Campaigns" above for schemas.
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

`POST /api/climbs2` is durability-hardened so climbs are never lost: each climb in `body.climbs` is upserted to its own atomically-written `climbs/{id}.txt` file inside an isolated try/catch (a malformed record is skipped, never aborting the batch), deletes require an explicit id-validated `body.deletedClimbIds`, and `body.sessions` is **merged by id** into the existing `sessions.txt` (upsert — never wholesale replace) so a stale or second device can add/update sessions but can never silently drop ones it did not send (there is no delete-session action). The response returns `{ ok, saved, skipped, deleted }`.

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
GET/PUT /api/lights/native/v1
POST/DELETE /api/lights/native/v1/session
GET  /api/lights/events
GET  /api/lights/device
GET/POST /api/lights/device/status
GET  /api/lights/homekit
```

`GET /api/lights` is public and returns `{ on, updatedAt }`. `GET /api/lights/events` is a public Server-Sent Events stream that immediately emits the same desired state payload whenever it changes. `POST /api/lights` requires bearer session auth and only username `yannick` can update `{ on: boolean }`. Device routes preserve legacy unauthenticated polling only when `LIGHTS_DEVICE_API_TOKEN` is unset, but those calls never create trusted telemetry. Once the same secret is configured in the server and ESP, both device routes require `X-Big-Tuna-Device-Token`; only authenticated polls/reports feed the website/native device indicators. `GET /api/lights/device` returns the inverted stored `on` value and `pollAfterMs: 250`. `GET /api/lights/device/status` returns the trusted `{ on, receivedAt, polledAt, recentlyPolled, recentWindowMs }` view.

`GET/PUT /api/lights/native/v1` is the owner-only Apple-client contract. It uses
physical-light terminology and returns `{ physicalOn, reportedPhysicalOn,
recentlyPolled, updatedAt, revision }`. `PUT` accepts `{ physicalOn, commandId }`;
command IDs are bounded and journaled for ten minutes so retries remain idempotent
across restarts, while conflicting reuse returns 409. Bodies are capped at 2KB.
`POST /api/lights/native/v1/session` exchanges an owner website session for the
scoped credential used by Apple extensions; `DELETE` revokes it. Native mutations serialize in-process and
translate through the existing inverted storage boundary without changing legacy
payloads.

`hap-nodejs` also starts a LAN-only HomeKit bridge named `BIG TUNA Lights` on TCP 51826, advertised by mDNS only through the physical Wi-Fi IPv4 address (explicit `HOMEKIT_BIND_ADDRESS`, otherwise the first IPv4 on `HOMEKIT_BIND_INTERFACE`, default `Wi-Fi`) so Tailscale and IPv6 routes cannot break Apple Home pairing. It translates HomeKit's physical-light `On` value through the existing website/device inversion and uses the same `writeLightsState` path, so the ESP device endpoints and schedule contract do not change. Pairing data lives in `data/lights/homekit/`; `GET /api/lights/homekit` returns status only to the authenticated `yannick` account, while the owner-gated `/api/lights/homekit/qr` returns a locally generated, no-store SVG from the HAP setup URI only before pairing. The Cloudflare Tunnel is not part of HomeKit discovery; see `docs/apple-home-lights.md` for the QR pairing/firewall guide.

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

Trivia:

```text
GET  /api/trivia/status
POST /api/trivia/generate
```

Both Trivia routes are authenticated. `GET /api/trivia/status` performs no paid request and reports the fixed provider/model, whether `OPENAI_API_KEY` is configured for typed topics, and whether the committed bank is ready with exactly 1,000 questions. `POST /api/trivia/generate` accepts `{ topic?: string, count?: number, difficulty?: 'easy'|'medium'|'hard', exclude?: string[] }`; `topic` is trimmed/clamped to 100 chars, `count` to 1–10, and `exclude` to the 80 most-recent texts. A blank topic samples without mutation from `lib/trivia-bank.json`, an immutable bank of exactly 1,000 unique questions created and twice verified by `gpt-5.6-luna`; responses are `source:'luna-bank'`, `provider:'openai'`, and always leave the bank at 1,000. Every nonblank topic uses only the OpenAI Responses API with the same fixed Luna model, strict JSON Schema output, canonical `{correctAnswer, incorrectAnswers:[3]}` validation, and two concurrent independent Luna fact-checks with shuffled, unmarked choices before server-side answer shuffling. Generation plus both checks share one 8-second abort deadline. Topic fills are coalesced in memory by normalized topic+difficulty, never fall back to unrelated bank questions, and return `source:'openai-topic'`; missing credentials, quota errors, timeouts, refusals, failed checks, or invalid output return 503 with `questions:[]` and secret-safe details. Valid browser questions remain `{ id, question, answers:[4], correct, category, difficulty, explanation }`. Run `npm run generate:trivia-bank` only as an intentional paid maintenance operation; it uses Luna for candidate creation plus two independent shuffled-choice verification passes, compares candidates against the entire bank with a semantic paraphrase/inversion gate, checkpoints outside the repo, and atomically replaces the bank only at the exact target size. `--repair` seeds from an existing twice-Luna-verified bank, and repeatable `--drop-id luna_…` arguments remove reviewed questions before verified replacements are generated.

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

`trivia`:

- Authenticated static app at `/trivia/` (Lumina Trivia). Native rebuild of the Stitch "Sleek Minimalist Trivia" design on `/styles/tokens.css`; route accent is `--c-yellow`, matching the homepage Trivia tile (set in `topbar.js`).
- Questions are supplied through `POST /api/trivia/generate`; availability/bank metadata comes from `GET /api/trivia/status`. A blank **Topic** means an immediate random mix from the immutable 1,000-question Luna bank. Every trimmed nonblank Topic, including one- and two-character values, requires a newly generated `gpt-5.6-luna` question and can never consume unrelated bank content. Difficulty is selected independently (Mixed / Easy / Medium / Hard).
- Questions are always four-answer multiple choice with the correct option shuffled server-side. Play modes are 10 / 25 / 50 questions or Endless. The per-question limit is adjustable from 1-60 seconds plus unlimited; speed scoring retains a fixed 20-second window so timer choices do not inflate rankings.
- **Ready-ahead generation:** the home screen fills a keyed `PREBANK`=4. Blank-topic requests have a short 2.5-second browser budget and may return a batch immediately; custom-topic requests pass their current ready-ahead demand into the server's keyed coordinator, which coalesces fills but atomically claims every twice-checked question only once. Topic requests have a 9.2-second browser budget around the server's 8-second OpenAI deadline and keep filling the transient bank as each response permits. Start immediately drains any question already ready; otherwise it shares `fetching[key]`, wakes on the first bank arrival instead of awaiting all four, and renders or fails under a strict 9.6-second click-to-first-question deadline while the remaining prebank continues. During play, `ensureBuffer()` keeps `PREFETCH`=3 ready ahead. Bank/run state remains keyed by topic **and** difficulty.
- **Fixed-run completion:** 10 / 25 / 50 runs complete only after the selected number of questions has been answered. Repeated live-generation misses keep the run open and switch to cooldown-paced automatic retries; they never write a partial run to stats/history. Endless mode retains its graceful completion behavior when generation remains unavailable.
- **Bank warm-up (`warmHomeBank`):** the home-screen bank (current Topic text + Difficulty) is (re-)warmed on load (in parallel with `/api/trivia/status`), on Difficulty change, ~450ms after the player pauses on every nonblank trimmed Topic (including one or two characters), immediately when Topic is cleared, and whenever the player returns home (quit/home/tab-to-Play).
- **Explanations / pacing:** after each answer, a short `explanation` memory-aid card is shown and the player advances with a **Next** button, which also buys time for the next question to finish generating.
- **No duplicates / shape safety:** the client remembers every question served (`run.seen`, normalised), sends up to 80 recent texts (`EXCLUDE_MAX`), and rejects malformed response items before the single `addUnique()` choke-point. The server applies the full exclusion list to immutable-bank selection and trims it only for compact OpenAI prompts.
- Per-user stats/history persist via `Auth.saveSettings('trivia', …)` (best score, games, totals, last 25 runs incl. difficulty) with a `localStorage` fallback; the in-app Rankings tab ranks the user's own completed runs by points. If the OpenAI key or live generation is unavailable, typed topics fail with retry guidance while the committed blank-topic Luna bank remains playable.

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
- UI is a native rebuild (no Tailwind/CDN) of the Stitch "Spectrum App Hub" CRUX climb screens (Dashboard `b6c4caf4fa4546cfa4f31fb2cee13e86`, Logbook `4dd2d3ca96504951a34edd2922cec048`, Analytics `ffbc7b4df0374eb798d7ca3897abac0f`) on `/styles/tokens.css`, inheriting the route accent (`--c-red`). It keeps the shared topbar/auth and presents three segmented views:
  - **Overview** — photo-style hero with live stat cards (climbs this month, peak send grade, day streak), the Start/End session control, a Progression bar chart (peak send grade per month, last 6 months), and a Recent Sends list.
  - **Logbook** — search/grade/status filters plus collapsible session cards (peak grade + send count per session) that expand to their climb cards (photo, status badge, delete).
  - **Stats** — summary tiles plus client-computed Grade Distribution bars, a 5-week Work Capacity heatmap, and derived Recent Milestones.
- Logging a climb happens in a slide-over sheet opened from the header "Add Climb"/"Add Photo" buttons (grade/hold-color/status/tries/photo/notes); all analytics are computed in the browser from real climb data. Hold-color swatches remain legitimate data-viz, not decoration.
- The client reconciles on `visibilitychange` (re-fetches when the tab regains focus) so edits made on another device/tab are picked up.

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

- Authenticated static app at `/eco-ai/`. User-facing name is **Emma** (title, topbar, brand, message author, placeholders, status/error copy, and the `topbar.js` APPS entry all say "Emma"); the route, `APP_ID`, data paths and API routes stay `eco-ai`. The only remaining literal "Eco AI" strings are an internal comment and the `pruneBrokenMessages` regex that cleans up legacy persisted `Eco AI error:` turns.
- Uses `topbar.js` and `auth.js`.
- Single-screen layout: `body` is sized to the visible viewport (`height: 100svh`, was `min-height: 100vh`) with `overflow: hidden` so the topbar, composer, and the model/skill selectors below it always fit without scrolling — `100vh` on mobile is the larger layout viewport and pushed the composer behind the browser chrome.
- Math: assistant/user message bodies render LaTeX via KaTeX (`katex@0.16.11` from jsDelivr, loaded `defer` in `<head>`). `renderMarkdown` extracts fenced code first, then display math (`$$…$$`, `\[…\]`) and inline math (`\(…\)`, `$…$`) to placeholders, escapes the remaining prose, then restores `katex.renderToString(...)` output (KaTeX escapes its own HTML, sidestepping the `< > &` conflict with HTML-escaping). The `$…$` form skips whitespace-edge/price patterns; if KaTeX hasn't loaded the raw source is shown and the conversation re-renders once it's ready.
- Model selector shows capability info: each `<option>` and the recommended Auto option include a friendly label with parameter size (e.g. "Qwen Coder · 7B") plus a `title` tooltip, and a `#model-capability` caption under the controls names the model that will answer with its size, quantization, a one-line strength blurb, and a speed/quality note. Profiles are keyed by family in `MODEL_PROFILES` / `describeModel()` using the `family`/`parameterSize`/`quantizationLevel` fields from `/api/eco-ai/status`.
- Deep link from the homepage Ask Emma bar: on load, if `location.search` has a non-empty `?q=`, the app strips the query string (`history.replaceState`, so a refresh won't resend), opens a fresh chat via `createAndSelectChat()`, drops the exact prompt into the composer, and calls `handleSend()` so the prompt is sent automatically.
- Uses `/api/eco-ai/status` to detect whether local Ollama is reachable and which models are installed.
- Uses `/api/eco-ai/chat` for streaming local chat completions proxied to Ollama. The stream is newline-delimited JSON and should surface upstream errors plus `done.empty` when Ollama returns no text so the UI never shows an empty assistant response. Unknown event types (e.g. `ping` keepalives) are ignored by the client.
- Generation is non-destructive: a failed request never persists an error as an assistant turn (the empty placeholder is dropped and a transient toast with a Retry action is shown instead), transient network failures auto-retry up to 3x before nothing has streamed, a failed regenerate restores the previous answer, and previously-saved error/empty assistant turns are pruned on load. Saves to `/api/data/eco-ai` retry and also flush on tab hide/`pagehide`.
- Persists conversation history in `/api/data/eco-ai` and user preferences in `Auth.saveSettings('eco-ai', ...)`.
- Supports multiple saved chats, simple mode presets (`general`, `coding`, `writing`, `study`, `summarize`, `file-analyst`), shorthand model switching with Auto as the default, and browser-read text/code file attachments that are appended to prompt context.
- The intended deployment is a local Ollama install on the website host machine. If Ollama is missing or offline, the UI should show a setup/offline message rather than failing silently.
- `eco-ai-models.txt` is now Emma-only (`llama3.1:8b` and `qwen2.5-coder:7b`); Trivia no longer installs or calls Ollama. `maintain-eco-ai-models.ps1` locates Ollama, enforces the CPU backend, starts/restarts its API if needed, and pulls every nonblank/noncomment model in that manifest. `setup-eco-ai-models.ps1` installs Ollama with `winget` if absent, runs maintenance immediately, and registers a current-user daily 7:00 AM task with missed-start recovery.
- The current Windows host must use `OLLAMA_LLM_LIBRARY=cpu_avx2`. Ollama generation crashes against the installed NVIDIA 546.17 driver with `CUDA error: device kernel image is invalid`; startup and maintenance scripts now persist/export the override. Keep it until the GPU driver/runtime combination has been upgraded and validated.

`lights`:

- Public static app at `/lights/`.
- Does not load `auth.js`, because the page must remain publicly viewable without showing the login modal.
- Chrome-free, text-free UI: just the light switch on its plate. There is no sign-in screen — control is gated on the existing cached `localStorage` auth session (username `yannick`), which is established elsewhere (another app page, the desktop or iPhone client).
- The plate's two screws double as status indicators: the **top** screw turns green (`body.is-authed`) when the cached session is `yannick` (can control); the **bottom** screw turns green (`body.is-polled`) when `/api/lights/device/status` reports `recentlyPolled` (device polled within the last 5 seconds).
- Reads `/api/lights` for state, inverts that API value client-side to match the Arduino-driven physical light state, and posts the inverse value back when toggled. The page enables toggling only when localStorage contains username `yannick`; the server enforces the same rule on `POST /api/lights`.
- Uses `/api/lights/events` SSE for near-instant same-page updates across open browsers, with 1-second `/api/lights` polling only as a fallback.
- Auto-schedule lives server-side in `server.js` (`startLightsScheduler`, runs on a 30s tick): lights turn **on at sunset** and **off at sunrise and at 22:00 local**. Sunrise/sunset are computed with a SunCalc-derived formula for Halifax (`LIGHTS_LAT`/`LIGHTS_LON`, `America/Halifax`). Transitions write `state.json` with `updatedBy: "schedule"` and fire each event at most once per day via crossing detection; a server restart seeds the baseline without retro-firing, so manual toggles between scheduled events are preserved. The schedule writes the website-on value (`LIGHTS_WEBSITE_INVERT` mirrors the page's `INVERT_WEBSITE_STATE`).
- Supports iPhone home-screen installation with Apple web-app meta tags and hides the shared topbar when launched in standalone display mode.
- The yannick-only HomeKit panel fetches `/api/lights/homekit` after session validation and shows a first-pair code/status. The HomeKit bridge is local-LAN only; pairing and normal HomeKit control do not change the ESP32 polling request contract. See `docs/apple-home-lights.md`.
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
- `.codex/config.toml` intentionally selects GPT-5.6-Sol with Ultra reasoning for the root, `approval_policy = "never"`, `danger-full-access`, and up to 6 direct concurrent subagents; `C:\SERVER` must remain trusted in the user's Codex configuration.
- Default orchestration for non-trivial work is root spec -> parallel lighter implementers with disjoint ownership -> parallel tester checks where useful -> root review/acceptance -> repeat until the spec passes.
- The root spec should define scope, constraints, ownership, implementation approach, and concrete acceptance checks that the final validation pass can execute.
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

## Strava Challenge

- The public homepage mounts the Yannick (fixed red) vs Emma (fixed blue) Strava Cup
  at `#strava-challenge`; its compact default view is scoreboard plus five activity
  recap lines per athlete. Expanded activities, statistics, history, and week detail
  are behind More.
- `lib/strava-challenge/` owns durable file-backed state in
  `data/strava-challenge/state.json`, OAuth credentials (AES-GCM encrypted), Strava
  synchronization, scoring, and Monday finalization. Never expose service state;
  public serializers explicitly allowlist output.
- Public API: `/api/strava-challenge/public` and `/api/strava-challenge/public/weeks/:weekStart`.
  Challenge administration is Yannick-only under `/api/admin/strava-challenge/*`.
  Invitation tokens are fragment-only, hashed server-side, and separate from OAuth state.

## Apple App Factory

- Reusable native source/template and operating specs live under `ios/app-factory/`.
  Future Apple work must read `docs/APPLE_APP_FACTORY.md` and the app's
  `ios/app-factory/specs/<slug>.yml` first; preserve its identity, enabled targets,
  data format, and app-group value across updates.
- `.github/workflows/apple-app-factory.yml` builds unsigned IPAs on GitHub macOS.
  It has no Apple credentials; private SSH deployment is main-only and disabled until
  all explicitly configured secrets, including a pinned known-hosts entry, exist.
- Specs may set `factory.sourceProject` to a validated repository-relative `ios/...`
  XcodeGen product directory. Generation copies it only into a fresh build output,
  verifies every requested bundle ID in `project.yml`, and writes schema-v2 target
  evidence. `targets.iphoneControls` requires iOS 18+ and reuses the iPhone widget
  extension; `targets.watchControls` requires watchOS 26+, a Watch app, and the Watch
  widget extension. IPA inspection fails when requested app/widget/Watch bundles or
  their declared control-extension evidence are missing.
- Release payloads live in ignored `data/apple-app-factory/releases/`, not static
  `apps/`. `/api/apple-app-factory/*` is session- and configured-owner-authenticated,
  with strict path/symlink protection; `/apple-apps/` is only its UI shell.
- Free Personal Team limits (three apps/device, three devices, ten App IDs, seven-day
  expiry) apply. Watch installer support and privileged capabilities remain unverified
  until documented physical-device acceptance checks pass.

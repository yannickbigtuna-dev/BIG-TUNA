# BIG TUNA

BIG TUNA is a personal self-hosted web app server for a collection of single-page tools. It runs on Windows, serves apps from the `apps/` directory, stores data as local files under `data/`, and can be exposed publicly through a Cloudflare Tunnel.

The main server is a plain Node.js HTTP server with no web framework. It serves static frontend files, shared client libraries, authentication, and all app APIs from `server.js`.

## Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Local Development](#local-development)
- [Windows Service Setup](#windows-service-setup)
- [One-Click Startup](#one-click-startup)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Adding Apps](#adding-apps)
- [Shared Frontend Libraries](#shared-frontend-libraries)
- [Data Storage](#data-storage)
- [API Overview](#api-overview)
- [MCP Server](#mcp-server)
- [Useful Commands](#useful-commands)

## Features

- Hosts multiple standalone HTML apps from one server.
- Automatically lists app folders on the homepage and app dropdown.
- Provides shared authentication and navigation scripts.
- Stores user accounts, sessions, settings, app data, quizzes, meets, climbs, and shared lists on disk.
- Supports real-time shared-list updates with Server-Sent Events.
- Includes a separate MCP server for controlled file and command access.
- Includes batch scripts for Cloudflare Tunnel, firewall, pm2, and Windows service setup.

Current apps include:

- `capitals-quiz`
- `eco-ai`
- `list-maker`
- `lights`
- `pace-calculator`
- `psych-sheet`
- `quiz-app`
- `terminal`
- `workout-timer`
- `world-map`

## Project Structure

```text
.
+-- apps/                    # Static frontend apps and shared browser scripts
|   +-- index.html           # Homepage/app launcher
|   +-- auth.js              # Shared auth client
|   +-- topbar.js            # Shared navigation bar
|   +-- */index.html         # Individual apps
+-- data/                    # File-based application data
+-- mcp-server/              # Model Context Protocol sidecar server
+-- server.js                # Main app/API server on port 3000
+-- pty-worker.js            # Terminal helper worker
+-- package.json             # Main server dependencies and scripts
+-- cloudflared-config.yml   # Cloudflare Tunnel configuration
+-- SETUP-GUIDE.md           # Detailed Cloudflare/Windows setup notes
+-- *.bat                    # Windows setup and startup helpers
```

## Requirements

- Windows
- Node.js
- npm
- Cloudflare account and domain, if exposing the server publicly
- `pm2`, if running the server continuously as a service
- `cloudflared`, if using Cloudflare Tunnel

Install project dependencies:

```powershell
npm install
```

Install MCP server dependencies separately:

```powershell
cd mcp-server
npm install
```

## Local Development

Start the main server:

```powershell
npm start
```

The server listens on:

```text
http://localhost:3000
```

There is no build step. Changes to files in `apps/` are picked up on the next browser refresh. Changes to `server.js` require restarting the Node process.

### Service restart convention

When a requested or implemented change requires a running-service restart, Codex restarts only the affected service after validation when the user has given standing authorization. For changes to `server.js`, the affected PM2 process is `apps-server`:

```powershell
pm2 restart apps-server
```

This convention does not authorize unrelated service restarts, deployment actions, or Git pushes; those remain subject to the task's explicit safety and authorization requirements.

Run the Node test suite with:

```powershell
npm test
```

## Windows Service Setup

This repo includes helper scripts for installing and running the server on Windows. Most service setup commands should be run from an Administrator terminal.

Common entry points:

```powershell
.\start-server.bat
.\start-all.bat
.\install-as-service.bat
```

The intended long-running setup uses pm2 for the Node servers:

```powershell
pm2 start C:\SERVER\server.js --name apps-server
pm2 start C:\SERVER\mcp-server\ecosystem.config.cjs
pm2 save
```

If this repository is not located at `C:\SERVER`, update the batch files, pm2 commands, and Cloudflare configuration paths before installing services.

## Trivia OpenAI Setup

Trivia uses OpenAI `gpt-5.6-luna` in two ways:

- Blank-topic games sample from the committed `lib/trivia-bank.json`, which
  contains exactly 1,000 Luna-generated questions and is never consumed at
  runtime.
- Typed topics are generated live through the OpenAI Responses API, then
  admitted only when two independent Luna checks select the same canonical
  answer. The API key stays on the server and is never sent to the browser.

Set `OPENAI_API_KEY` in the server environment (see `server.env.example`), then
apply it to PM2 with:

```powershell
pm2 restart ecosystem.config.cjs --update-env
```

The bank is a deployable asset, not live mutable state. Regenerate it only as
an intentional maintenance operation; the generator uses Luna for candidate
creation and two independent answer-verification passes before admitting a
question. It rejects paraphrases of an existing fact across the entire bank,
checkpoints resumable work outside the repository, and replaces the bank only
after exact-size validation:

```powershell
npm run generate:trivia-bank
npm test
```

To keep the accepted portion of an existing twice-verified bank while replacing
duplicates or a reviewed question, use `--repair`; repeat `--drop-id` for any
specific Luna question IDs that must be replaced.

Never commit the API key, `server.env`, checkpoints, or partial generator
output.

## Eco AI Ollama Maintenance

Eco AI uses a local Ollama install on the website host. The repo keeps the baseline model list in `eco-ai-models.txt` and uses helper scripts to keep those models pulled.

Run the one-time setup from a Windows terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SERVER\setup-eco-ai-models.ps1
```

That script:

- installs Ollama with `winget` if it is missing
- runs `maintain-eco-ai-models.ps1` immediately
- registers a current-user daily task for 7:00 AM with missed-start recovery

The maintenance script starts the Ollama API if needed and pulls every nonblank, noncomment model in `eco-ai-models.txt`.

## One-Click Startup

Use `start-all.bat` or the Desktop `BIG-TUNA-Start-Everything.bat` shortcut file to start the production stack in one step. Both call `start-everything.ps1`, which:

- starts or restarts the main `apps-server` PM2 process on port `3000`
- starts or restarts the `mcp-server` PM2 process on port `3001`
- saves the PM2 process list
- starts `cloudflared.exe` with `cloudflared-config.yml` if the tunnel is not already running
- starts `auto-update.ps1` hidden in the background if the git reloader is not already running

Run it directly if needed:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SERVER\start-everything.ps1
```

The git reloader polls `origin/main` every 10 seconds and pulls when GitHub has a newer commit. After a successful pull it refreshes production dependencies with `npm install --omit=dev --no-audit --no-fund` before restarting `apps-server`; if that refresh fails, it leaves the current server process running.

The startup script also attempts to start the local Ollama API in the background without blocking the rest of the stack.

## Cloudflare Tunnel

Cloudflare Tunnel lets the server run from a Windows machine without port forwarding. The tunnel forwards public traffic to `localhost:3000`.

The detailed setup flow is documented in [SETUP-GUIDE.md](SETUP-GUIDE.md).

Typical setup:

```powershell
.\setup-cloudflare.bat
cloudflared tunnel login
cloudflared tunnel create my-server
```

Then edit `cloudflared-config.yml` with:

- The generated tunnel ID
- The path to the tunnel credentials JSON
- The public hostname for the site

Add DNS routes:

```powershell
cloudflared tunnel route dns my-server example.com
cloudflared tunnel route dns my-server www.example.com
```

Run the tunnel manually while testing:

```powershell
cloudflared tunnel --config .\cloudflared-config.yml run
```

## Adding Apps

Each app is a folder under `apps/` with an `index.html` file:

```text
apps/
+-- my-app/
    +-- index.html
```

After adding the folder, the app is served at:

```text
http://localhost:3000/my-app/
```

It also appears on the homepage and in the shared app dropdown.

Recommended app template:

```html
<script src="/topbar.js"></script>
<script src="/auth.js"></script>
<script>
  Topbar.setTitle('My App');

  Auth.onReady(user => {
    // Start app after authentication is ready.
  });
</script>
```

## Shared Frontend Libraries

### `topbar.js`

`/topbar.js` injects the shared top navigation. Load it before `/auth.js`.

Useful APIs:

- `Topbar.setTitle(title)`
- `Topbar.addLeft(element)`

### `auth.js`

`/auth.js` handles login, registration, session validation, account UI, and per-user settings helpers.

Useful APIs:

- `Auth.onReady(callback)`
- `Auth.saveSettings(appId, data)`
- `Auth.loadSettings(appId)`
- `Auth.beforeLogout(callback)`

The client stores the auth token and cached user in `localStorage`.

## Data Storage

This project does not use a database. Data is stored as JSON, text, and image files under `data/`.

Important paths:

```text
data/users.json                         # User accounts
data/sessions.json                      # Active sessions
data/settings/{userId}/{appId}.json     # Per-user app settings
data/appdata/{appId}/{userId}.json      # Generic per-user app data
data/climbs/{userId}/                   # Climb tracker v1 data
data/climb-tracker/{userId}/            # Climb tracker v2 data and photos
data/meets/{userId}.json                # Psych sheet meets
data/quizzes/{userId}/{quizId}.json     # Quiz data
data/shared-lists/{id}.json             # Shared list data
```

Writes are performed with a temporary file followed by rename where applicable to reduce the risk of corrupted files.

## API Overview

All API routes are implemented in `server.js`.

Authentication:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Authenticated data APIs use:

```text
Authorization: Bearer <token>
```

Main app APIs:

```text
GET/POST          /api/settings/:appId
GET/POST          /api/data/:appId
GET/POST          /api/climbs
GET/POST          /api/climbs2
POST/GET/DELETE   /api/climbs2/photo/:id
GET/POST          /api/quizzes
GET/PUT/DELETE    /api/quizzes/:id
GET/POST          /api/meets/psych-sheet
GET/PATCH/DELETE  /api/meets/psych-sheet/:id
GET/POST          /api/shared-lists
GET/POST/DELETE   /api/shared-lists/:id
GET               /api/shared-lists/:id/events
GET               /api/users/lookup
GET               /api/waquatics/search
GET               /api/waquatics/athlete
POST              /api/parse-pbest
GET/POST          /api/lights
GET               /api/lights/events
GET               /api/lights/device
GET/POST          /api/lights/device/status
```

The ESP8266 prompt for generating Lights relay firmware is documented in [docs/lights-esp8266-prompt.txt](docs/lights-esp8266-prompt.txt).

## Yannick vs Emma Strava Challenge

The homepage includes a public, read-only hockey-arena scoreboard for the annual
Yannick (red) vs Emma (blue) activity challenge. It shows the live current week,
finalized season points, recent qualifying and non-qualifying activities, current
and season statistics, and drill-down history for finalized weeks. The old
homepage clock was local to the launcher and has been replaced; the independent
Workout Timer clock is unchanged.

The integration uses the official Strava OAuth and athlete-activities APIs. This
specific public cross-athlete display and historical retention operates under the
owner's written Strava approval. Do not reuse this implementation for additional
athletes or another public data product without confirming that approval covers the
new use.

### Competition rules

- A week is Monday 00:00 through the next Monday 00:00 in
  `America/Halifax`. Activities are assigned by their UTC start instant converted
  to that timezone.
- Runs require 4,000 metres, walks require 2,000 metres, and swims require 3,000 metres.
- Gym/workout/weight activities require 1,200 seconds; paddle/row activities
  require 1,800 seconds; climbing requires 3,600 seconds.
- Every qualifying activity is worth one activity, regardless of excess distance
  or duration.
- More qualifying activities wins. If counts match, exact total qualifying
  activity seconds decides the winner. Equal count and equal seconds is a true tie
  and awards no point.
- Run, swim, walk, paddle, and row use Strava `moving_time` (with elapsed fallback).
  Gym and climbing use `elapsed_time` (with moving fallback), because rest and
  belay time are representative parts of those sessions.
- The current week is live and never awards an early point. A finalized week is an
  immutable official snapshot; season standings are derived from those snapshots.

### Runtime data and migration

There is no SQL database or ORM in BIG TUNA. On first use, the server creates and
migrates the versioned file:

```text
data/strava-challenge/state.json
```

It contains normalized activities, hashed invitation/OAuth-state records,
encrypted credentials, sync metadata, and finalized snapshots. The entire `data/`
tree is gitignored. Initialization/migration is automatic when the server starts;
there is no separate migration command. Back up `data/strava-challenge/` together
with the rest of live `data/` before deployment or recovery work.

### Environment configuration

Copy `server.env.example` to the gitignored `server.env` and configure:

```text
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://yannickmorgans.ca/api/strava-challenge/oauth/callback
CHALLENGE_BASE_URL=https://yannickmorgans.ca
STRAVA_CHALLENGE_YEAR=2026
STRAVA_CHALLENGE_START_DATE=2026-01-01
STRAVA_CHALLENGE_YANNICK_EMAIL=
STRAVA_CHALLENGE_EMMA_EMAIL=
STRAVA_CHALLENGE_CRYPTO_SECRET=
STRAVA_CHALLENGE_INVITE_TTL_HOURS=168
STRAVA_CHALLENGE_SYNC_INTERVAL_MINUTES=30
STRAVA_CHALLENGE_FINALIZE_HOUR=8
STRAVA_CHALLENGE_FROM_EMAIL=challenge@yannickmorgans.ca
STRAVA_CHALLENGE_DISCLOSURE_APPROVED=true
```

`CHALLENGE_BASE_URL` falls back to `PUBLIC_BASE_URL`. Generate the encryption
secret once with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Keep that value stable and backed up. Changing or losing it makes stored Strava
credentials unreadable and requires both participants to reconnect. Never commit
`server.env`, a client secret, an invitation link, or an access/refresh token.

Email delivery reuses the existing `RESEND_API_KEY`. The domain in
`STRAVA_CHALLENGE_FROM_EMAIL` must be verified in Resend. Invitation and result
messages use persisted delivery state and Resend idempotency keys so scheduler or
deployment retries cannot send duplicates.

### Strava developer application

1. Sign in to Strava with the developer account and open
   `https://www.strava.com/settings/api`.
2. Create one application for this website. A current Strava subscription is
   required to create an app.
3. Set **Website** to `https://yannickmorgans.ca`.
4. Set **Authorization Callback Domain** to `yannickmorgans.ca` (domain only; do
   not paste a path there).
5. Set the full server callback in `server.env` exactly to
   `https://yannickmorgans.ca/api/strava-challenge/oauth/callback`.
6. Copy the application Client ID and Client Secret into `STRAVA_CLIENT_ID` and
   `STRAVA_CLIENT_SECRET`. Keep the secret server-side.
7. Upgrade the application from its initial single-player capacity to the
   self-service 10-athlete capacity before connecting the second participant.
8. The website requests only `activity:read_all`. A participant can uncheck that
   permission on Strava; the connection is rejected with a useful error rather
   than silently showing incomplete results.

The invitation link and OAuth `state` are separate. Invitation links carry a
random token in a URL fragment so the raw token is not sent to request logs or
referrers. Only a SHA-256 hash is stored. OAuth state is separately hashed,
participant-bound, expiring, and single-use. Access and refresh tokens are
AES-256-GCM encrypted at rest and never sent to browser JavaScript.

### Connecting Yannick and Emma

Sign in as the `yannick` BIG TUNA account and open `/admin/`, then select the
Strava Challenge view.

For Yannick:

1. Confirm Yannick's challenge email and save the configuration.
2. Select **Send connection email** on Yannick's red participant panel. This
   revokes any older unused Yannick invitation and sends a new expiring link.
3. Yannick opens the link. The website validates it server-side, identifies the
   fixed Yannick slot, explains the data use, and shows **Connect with Strava**.
4. Strava asks Yannick to sign in and approve activity access. He never gives the
   website a Strava password or copied token.
5. After authorization, the callback validates one-time state and granted scope,
   associates the returned athlete ID with Yannick, encrypts the newest tokens,
   consumes the invitation, and attempts the initial historical sync.
6. Confirm the admin panel shows **Connected**, the athlete ID, initial-history
   status, and a recent successful sync timestamp.

Repeat the same steps from Emma's blue participant panel. Emma's invitation is
server-bound only to Emma and cannot be edited into a Yannick invitation. The
returned Strava display name is never used to choose a participant. **Reconnect**
issues a fresh invitation and replaces credentials only after a successful OAuth
flow.

### Synchronization and Monday finalization

The challenge scheduler runs inside the continuously running PM2 `apps-server`
process, alongside the existing site jobs:

- a delayed startup pass catches up work missed while the server was offline;
- connected athletes are incrementally synchronized every 30 minutes in the live
  challenge configuration;
- signed-in `yannick` and `fishyemma` can use the homepage **Refresh activities**
  control to sync both participant slots on demand; it has a shared five-minute
  cooldown and reloads the cached scoreboard;
- at or after 08:00 Monday in `America/Halifax`, the previous week is synchronized
  through Sunday for both athletes and finalized only if both required syncs
  succeed;
- overdue unfinalized weeks are retryable after outages or restarts;
- homepage requests read local cached state and never call Strava.

Initial connection paginates back to `STRAVA_CHALLENGE_START_DATE`, subject to the
activities Strava makes available to the authorized account and current API rate
limits. Admin status records whether that initial import completed; incomplete
history is labeled rather than silently presented as complete. Regular syncs
reconcile the live/unfinalized window for duplicates, edits, and deletions while
leaving finalized official snapshots unchanged under the written approval.

### Safe manual testing

All mutation controls below require the signed-in `yannick` account:

- **Manual sync:** `/admin/` → Strava Challenge → **Sync Yannick**, **Sync Emma**,
  or **Sync both**.
- **Current/weekly calculation:** use **Preview finalization**. It computes the
  result without awarding a point or sending email.
- **Manual finalization:** preview first, then type the exact confirmation shown
  (`FINALIZE YYYY-MM-DD`). Repeating the same week is idempotent.
- **Connection email preview:** choose `connection` in Email Preview. No real
  invitation is generated or sent.
- **Invitation-link test:** choose **Generate test link**. The raw link is shown
  once; use it in a private browser window. Generating another revokes the prior
  unused invitation.
- **Winner/loser/tiebreaker/tie previews:** select the corresponding Email Preview
  scenario. Preview HTML is isolated in a sandboxed frame and is not sent.
- **Historical UI:** open `/?challengeDemo=1` for fixed, clearly labeled preview
  data, or open a real finalized result with `/?week=YYYY-MM-DD#strava-challenge`.
- **Automated focused tests:**

  ```powershell
  node --test test/strava-*.test.js
  ```

Run the full regression suite before deployment:

```powershell
npm test
```

### Deployment

No package installation, SQL migration, new PM2 process, Windows Scheduled Task,
or Cloudflare route is required. After pulling the code and filling `server.env`,
load the new values explicitly:

```powershell
cd C:\SERVER
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```

Verify locally before sending invitations:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/strava-challenge/public
```

Then check `/`, `/admin/`, and `/strava-connect/` through the public hostname. A
Strava outage does not break `/`; cached challenge data remains available with a
last-updated/stale indicator, and failed required syncs prevent finalization.

## MCP Server

The `mcp-server/` directory contains a separate Model Context Protocol server that runs on port `3001`. It uses `@modelcontextprotocol/sdk` and requires an `MCP_SECRET` value.

The pm2 ecosystem file loads the secret from:

```text
mcp-server/token.txt
```

Start it with pm2:

```powershell
pm2 start C:\SERVER\mcp-server\ecosystem.config.cjs
```

Or use the included helper:

```powershell
.\start-mcp.bat
```

## Useful Commands

Main server:

```powershell
npm start
pm2 start C:\SERVER\server.js --name apps-server
pm2 restart apps-server
pm2 stop apps-server
pm2 logs apps-server
pm2 status
```

MCP server:

```powershell
pm2 start C:\SERVER\mcp-server\ecosystem.config.cjs
pm2 restart mcp-server
pm2 logs mcp-server
```

Cloudflare Tunnel service:

```powershell
sc start cloudflared
sc stop cloudflared
sc query cloudflared
```

Everything needed on the live machine:

```powershell
.\start-all.bat
```

## Notes

- `data/` contains live application state. Back it up before migrations or cleanup.
- Some scripts and documentation assume the deployment path is `C:\SERVER`.
- `cloudflared.exe`, logs, token files, and local data may be machine-specific.

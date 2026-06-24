# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Rules (read first)

This is a live website repo. The live server machine auto-pulls from GitHub and updates the Cloudflare Tunnel site.

At the start of every session:

1. Run `git pull origin main` first.
2. Read `CODEX_CONTEXT.md` before making changes. It is the persistent project map shared with Codex — keep it as the single source of truth for both agents.

### Multi-agent workflow for every requested change

Every change must be engineered and planned before any code is written, then built, then independently tested. Use this loop:

1. **Architect (plan with the best model).** Drive the planning pass with the most capable Claude model available (Opus — currently `claude-opus-4-8`) acting as the architect and top-level coordinator. The architect inspects the request, gathers the minimum required repo context, and writes a thorough implementation spec **before any coding starts**.
2. The spec must be detailed enough to double as the acceptance and testing checklist for the later validation pass.
3. **Dispatch to sub-agents (build with efficient models).** Delegate the actual implementation to sub-agents running cheaper, more efficient models (e.g. Sonnet `claude-sonnet-4-6`, or Haiku `claude-haiku-4-5-20251001` for simple tasks), each given a clear task prompt derived directly from the spec. Use the `Agent` tool to spawn them.
4. **Tester (validate with the most capable model).** After the sub-agents report back, run a dedicated testing/validation agent on the most capable model available (Opus — `claude-opus-4-8`). The tester verifies the implementation against the architect's spec, runs/inspects the relevant tests, checks for regressions, and confirms the work behaves as intended.
5. **Feedback loop.** If tests fail or the work is incomplete, incorrect, or weak, send specific feedback from the tester to a **new** sub-agent pass and rebuild. Repeat implement → report → test → feedback until the work fully meets the architect's original spec. Do not ship work that has not passed the tester against the spec.

### Finishing every requested change

1. Make the requested edits.
2. Update `CODEX_CONTEXT.md` in the same change if architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards changed.
3. Run `git status` and `git diff`.
4. If the change is complete and has passed the tester, commit with a clear message.
5. Push to main using `git push origin main`.
6. Tell the user what changed and that it was pushed.

Never commit `.env` files, passwords, API keys, `node_modules`, or local cache/build junk.
Do not force push. Do not rewrite history. If there is a merge conflict, stop and explain it.

## What This Is

BIG TUNA — a personal self-hosted web server running on Windows at yannickmorgans.ca. It serves a collection of single-page apps through a Cloudflare Tunnel (no port forwarding needed).

## Server Management

```bash
# Start/manage the main app server (port 3000)
pm2 start C:\SERVER\server.js --name apps-server
pm2 restart apps-server
pm2 stop apps-server
pm2 logs apps-server
pm2 status

# Start/manage the MCP server (port 3001)
pm2 start C:\SERVER\mcp-server\ecosystem.config.cjs
pm2 restart mcp-server
pm2 logs mcp-server

# Cloudflare tunnel
sc start cloudflared
sc stop cloudflared
sc query cloudflared
```

No build step — just restart pm2 after editing `server.js`. Frontend changes (HTML/JS files in `apps/`) take effect immediately on next page load.

## Architecture

### Two servers

- **`server.js`** (port 3000) — main app server. Pure Node.js stdlib (`http`, `fs`, `crypto`), no frameworks. Serves static files from `apps/` and handles all API routes.
- **`mcp-server/server.js`** (port 3001) — MCP (Model Context Protocol) server. ES module, uses `@modelcontextprotocol/sdk`. Exposes tools (`read_file`, `write_file`, `list_directory`, `run_command`, `server_status`) over HTTP. Requires `MCP_SECRET` env var (loaded from `mcp-server/token.txt` via ecosystem.config.cjs).

Both are managed by pm2 and exposed publicly via Cloudflare Tunnel.

### Frontend apps

Each app lives in `apps/{app-name}/index.html`. Adding a new app is just dropping a folder with an `index.html` — it auto-appears on the homepage and in the topbar APPS dropdown.

Current apps: `workout-timer`, `quiz-app`, `psych-sheet`, `list-maker`, `world-map`, `pace-calculator`.

### Shared frontend libraries (served at root)

- **`/auth.js`** — authentication library. Auto-initializes on load. Shows a login/register modal if not authenticated. After auth, injects an account widget. Apps use `Auth.onReady(fn)` to gate their startup. Also exposes `Auth.saveSettings(appId, data)` / `Auth.loadSettings(appId)` and `Auth.beforeLogout(fn)` for flushing data before logout.
- **`/topbar.js`** — navigation bar. Must be loaded before `/auth.js`. Injects a sticky topbar with HOME button, APPS dropdown, and a `[data-auth-widget]` slot that `auth.js` fills. API: `Topbar.setTitle('name')`, `Topbar.addLeft(element)`.

Standard app template:
```html
<script src="/topbar.js"></script>
<script src="/auth.js"></script>
<script>
  Auth.onReady(user => { /* start the app */ });
</script>
```

### File-based storage (no database)

All data lives under `data/`. Writes use an atomic pattern (write to `.tmp`, then `fs.renameSync`) to prevent corruption.

| Path | Contents |
|------|----------|
| `data/users.json` | All user accounts |
| `data/sessions.json` | Active sessions (auto-pruned on write) |
| `data/settings/{userId}/{appId}.json` | Per-user app settings |
| `data/appdata/{appId}/{userId}.json` | Generic per-user app data |
| `data/climbs/{userId}/c_{id}.json` | Climb tracker climbs (soft-delete) |
| `data/climbs/{userId}/s_{id}.json` | Climb tracker sessions (soft-delete) |
| `data/climb-tracker/{userId}/climbs/{id}.txt` | Climb tracker v2 (key=value text) |
| `data/climb-tracker/{userId}/photos/{id}.jpg` | Climb tracker v2 photos |
| `data/meets/{userId}.json` | Psych sheet meets |
| `data/quizzes/{userId}/{quizId}.json` | Quiz data |
| `data/shared-lists/{id}.json` | Shared lists (all members in one file) |

### API surface (all in `server.js`)

Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`

Data APIs (all require `Authorization: Bearer <token>`):
- Settings: `GET/POST /api/settings/:appId`
- Generic data: `GET/POST /api/data/:appId`
- Climbs v1: `GET/POST /api/climbs`
- Climbs v2: `GET/POST /api/climbs2`, `POST/GET/DELETE /api/climbs2/photo/:id`
- Quizzes: `GET/POST /api/quizzes`, `GET/PUT/DELETE /api/quizzes/:id`
- Psych-sheet meets: `GET/POST /api/meets/psych-sheet`, `GET/PATCH/DELETE /api/meets/psych-sheet/:id`
- Shared lists: `GET/POST /api/shared-lists`, `GET/POST/DELETE /api/shared-lists/:id`, `GET /api/shared-lists/:id/events` (SSE)
- World Aquatics proxy: `GET /api/waquatics/search`, `GET /api/waquatics/athlete`
- PDF parser: `POST /api/parse-pbest`

ID validation: all user-supplied IDs used as filenames go through `isValidId()` — alphanumeric plus `_` and `-`, max 64 chars.

### Auth flow

Sessions are 30-day bearer tokens stored in `data/sessions.json`. Passwords use SHA-256 with a per-user random salt. The `auth.js` client caches `auth_token` and `auth_user` in `localStorage`; on load it fires ready immediately if a cached user exists, then validates the token in the background (silent re-login if 401).

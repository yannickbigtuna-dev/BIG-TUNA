# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Rules (read first)

This is a live website repo. The live server machine auto-pulls from GitHub and updates the Cloudflare Tunnel site.

At the start of every session:

1. Run `git pull origin main` first.
2. Read `CODEX_CONTEXT.md` before making changes. It is the persistent project map shared with Codex — keep it as the single source of truth for both agents.

### Delegation workflow

Diagnose every requested change yourself first — never delegate the diagnosis. Then pick a track based on size:

**Small, well-scoped fixes (the common case):**
1. Investigate the relevant code and diagnose the actual problem.
2. Write a short, specific fix plan (files, functions, expected change).
3. Delegate the implementation to the `implementer` subagent, giving it the diagnosis + plan verbatim.
4. If multiple independent fixes are needed, spawn multiple `implementer` subagents in parallel.
5. Review the diff the subagent reports before telling the user the task is done.

**Larger or architectural changes** (new features, multi-file refactors, anything touching data formats, APIs, deployment, or security assumptions) — use a heavier three-stage loop instead:
1. **Architect.** Plan with the most capable Claude model available (Opus), acting as architect/coordinator. Inspect the request, gather the minimum repo context, and write a thorough implementation spec **before any coding starts**. The spec must be detailed enough to double as the acceptance/testing checklist.
2. **Build.** Delegate implementation to efficient-model sub-agents (e.g. the `implementer` subagent) using Sonnet, or Haiku for simple tasks, each given a task prompt derived directly from the spec.
3. **Test.** Run a dedicated validation pass on the most capable model available. Verify the implementation against the spec, run/inspect relevant tests, check for regressions.
4. **Feedback loop.** If validation fails or the work is incomplete, send specific feedback to a **new** sub-agent pass and rebuild. Repeat build → test → feedback until the work fully meets the spec. Do not ship work that hasn't passed this validation pass.

### Finishing every requested change

1. Make the requested edits.
2. Update `CODEX_CONTEXT.md` in the same change if architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards changed.
3. Run `git status` and `git diff`.
4. If the change is complete — and, for larger changes, has passed the validation pass — commit with a clear message.
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

**App accent color convention:** every app is themed to a single rainbow token from `tokens.css` (`--c-red` … `--c-pink`). An app's in-app accent — the `color` set for it in `topbar.js`, which becomes `--accent` on that route — **must be the same rainbow token as its icon/tile on the homepage grid** (`apps/index.html`, the `--tile` on its `.card`). Set the same token in both places so the launcher tile and the app's interior share one identity. (Example: Trivia is `--c-yellow` on the homepage tile and as its route accent.)

Current apps: `assignments`, `capitals-quiz`, `climb-tracker`, `eco-ai`, `emma`, `lights`, `list-maker`, `pace-calculator`, `psych-sheet`, `quiz-app`, `terminal`, `trivia`, `weather`, `workout-timer`, `world-map`.

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
- Trivia (AI-generated): `POST /api/trivia/generate` (local Ollama; `{ topic?, count?, model?, difficulty?, exclude? }` → validated 4-answer questions with explanations; `exclude` avoids duplicate questions)
- Psych-sheet meets: `GET/POST /api/meets/psych-sheet`, `GET/PATCH/DELETE /api/meets/psych-sheet/:id`
- Shared lists: `GET/POST /api/shared-lists`, `GET/POST/DELETE /api/shared-lists/:id`, `GET /api/shared-lists/:id/events` (SSE)
- World Aquatics proxy: `GET /api/waquatics/search`, `GET /api/waquatics/athlete`
- PDF parser: `POST /api/parse-pbest`

ID validation: all user-supplied IDs used as filenames go through `isValidId()` — alphanumeric plus `_` and `-`, max 64 chars.

### Auth flow

Sessions are 30-day bearer tokens stored in `data/sessions.json`. Passwords use SHA-256 with a per-user random salt. The `auth.js` client caches `auth_token` and `auth_user` in `localStorage`; on load it fires ready immediately if a cached user exists, then validates the token in the background (silent re-login if 401).

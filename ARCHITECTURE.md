# BIG TUNA — Architecture & Conventions

A short, opinionated map of how this project is built, so any file makes sense in
under a minute. For the exhaustive route/data reference, see `CODEX_CONTEXT.md`.

## The shape of the thing

A personal, self-hosted website: one Node process serves a set of standalone
single-page apps and a small JSON/file API. No framework, no build step, no
database. Edit a file, reload the page.

```
server.js              Main HTTP server + all /api routes (CommonJS, port 3000)
pty-worker.js          Forked PTY worker for the web terminal
lib/                   Server-side modules loaded by server.js (e.g. assignment-coach)
apps/                  Everything served to the browser
  index.html             Homepage launcher
  topbar.js              Shared nav bar (load before auth.js)
  auth.js                Shared auth client + account widget
  styles/tokens.css      Design tokens — the single source of visual truth
  <app>/index.html       One self-contained app per folder
data/                  Live file-backed state (treat as production data)
mcp-server/            Separate MCP server (ES modules, port 3001)
```

## Patterns (pick one per concern, use it everywhere)

**Data fetching — `fetch`.** Always `fetch`, never XHR/axios. Server replies go
through `jsonRes(res, status, data)`; request bodies through `parseBody(req)`.

**Auth — bearer token via the shared client.** `apps/auth.js` owns login state.
Apps call `Auth.onReady(user => …)` to start, `Auth.saveSettings/loadSettings`
for per-user settings, and `Auth.autoSync` for periodic persistence. Tokens are
30-day bearers in `data/sessions.json`; passwords are salted SHA-256. Browser
APIs that can't set headers use a `?t=<token>` query param — sparingly.

**Persistence — atomic file writes.** Durable JSON goes through
`atomicWrite()` (write `.tmp`, then rename). Any user-supplied id used in a path
must pass `isValidId()` (alphanumeric + `_`/`-`, ≤64 chars).

**Styling — design tokens, one system.** `apps/styles/tokens.css` defines all
color, type, spacing, radius, and elevation as CSS custom properties, plus a
reset, accessible focus ring, and opt-in `.btn/.field/.card` primitives. Every
app links it and derives its styles from `var(--…)`. **No hardcoded hex, no
ad-hoc radii, no one-off shadows in an app.** See "Design system" below.

**Server-sent events** (shared lists, lights) over `GET …/events?t=…`; the web
terminal uses a WebSocket. Both are server-push channels — don't poll where an
SSE/WS stream already exists.

## Design system (tokens.css)

The visual language is a quiet dark "instrument panel": near-black surfaces, a
single **red** accent, monospace for numeric/technical readouts.

| Concern   | Tokens |
|-----------|--------|
| Surfaces  | `--bg` → `--bg-raised` → `--surface` → `--surface-2` → `--surface-3` |
| Borders   | `--border`, `--border-strong` |
| Text      | `--text` → `--text-muted` → `--text-dim` → `--text-faint` |
| Accent    | `--accent` `#ff453a`, `--accent-hover`, `--accent-press`, `--accent-soft`, `--accent-ring` |
| Semantic  | `--success` (green), `--warning` (amber), `--danger` (= accent) |
| Type      | `--font-ui`, `--font-mono`; sizes `--text-xs … --text-3xl`; weights 400/600/700/900 |
| Spacing   | `--space-1 … --space-16` (4px grid) |
| Radius    | `--radius-sm` 8, `--radius` 12, `--radius-lg` 16, `--radius-full` |
| Elevation | `--shadow-1/2/3` (only three steps) |
| Motion    | `--ease`, `--dur-fast/--dur/--dur-slow`; honors `prefers-reduced-motion` |

Focus: keyboard users get a visible `--ring`; never remove focus outlines from
custom-styled controls without replacing them.

## Adding an app

Drop `apps/<name>/index.html`. It auto-appears via static serving. Standard boot:

```html
<head>
  <link rel="stylesheet" href="/styles/tokens.css">
  ...
</head>
<body>
  <script src="/topbar.js"></script>   <!-- before auth.js -->
  <script src="/auth.js"></script>
  <script>
    Topbar.setTitle('My App');
    Auth.onReady(user => { /* start the app */ });
  </script>
</body>
```

Style it with `var(--…)` tokens only. Then add it to the homepage grid
(`apps/index.html`) and the `APPS` list in `apps/topbar.js`.

## Conventions

- CommonJS in the root server; ES modules only inside `mcp-server/`.
- New API routes live in `handleAPI`; keep specific routes before broad dynamic ones.
- Don't introduce a framework, bundler, transpiler, or database.
- Don't log secrets, tokens, passwords, or raw private user data.
- Don't commit `node_modules`, logs, binaries (`cloudflared.exe`), `.env`, or token files.
- This is a live site that auto-deploys from `main`. Keep changes scoped; don't force-push.

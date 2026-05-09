# BIG TUNA

BIG TUNA is a personal self-hosted web app server for a collection of single-page tools. It runs on Windows, serves apps from the `apps/` directory, stores data as local files under `data/`, and can be exposed publicly through a Cloudflare Tunnel.

The main server is a plain Node.js HTTP server with no web framework. It serves static frontend files, shared client libraries, authentication, and all app APIs from `server.js`.

## Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Local Development](#local-development)
- [Windows Service Setup](#windows-service-setup)
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

The default test script is currently a placeholder:

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

The intended long-running setup uses pm2 for the Node server:

```powershell
pm2 start C:\SERVER\server.js --name apps-server
pm2 save
```

If this repository is not located at `C:\SERVER`, update the batch files, pm2 commands, and Cloudflare configuration paths before installing services.

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
POST              /api/lights/device/status
```

The ESP8266 prompt for generating Lights relay firmware is documented in [docs/lights-esp8266-prompt.md](docs/lights-esp8266-prompt.md).

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

## Notes

- `data/` contains live application state. Back it up before migrations or cleanup.
- Some scripts and documentation assume the deployment path is `C:\SERVER`.
- `cloudflared.exe`, logs, token files, and local data may be machine-specific.

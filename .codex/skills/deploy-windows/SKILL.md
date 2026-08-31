---
name: deploy-windows
description: Safely plan and execute deployments to the BIG-TUNA live Windows home server. Use when a task explicitly authorizes pulling a release, installing changed dependencies, restarting PM2 processes, checking localhost or public endpoints, verifying Cloudflare Tunnel behavior, or rolling back a deployment.
---

# Windows Deployment Skill

Use for changes affecting the live home server.

Authorization guard: Pulls, restarts, deployments, and public checks require explicit authorization. Never let this workflow override task-specific Git, restart, deployment, or public-access restrictions.

Before deployment:
- Confirm working tree and intended commit.
- Back up `data/` when storage or routes change.
- Confirm secrets/config remain local.
- Check Node/npm dependencies and Windows path assumptions.
- Define rollback commit and data rollback separately.

Deploy:
1. Pull the intended commit.
2. Install dependencies only if lockfiles changed.
3. Restart only affected PM2 processes.
4. Verify PM2 status and logs.
5. Check localhost health before public URL.
6. Verify Cloudflare Tunnel only if networking changed.
7. Exercise one authenticated app and affected device endpoint.
8. Roll back immediately on data corruption, auth failure, restart loop, or unsafe device behavior.

# Codex Workflow for BIG TUNA

## Authority and required workflow
`AGENTS.md`, `CODEX_CONTEXT.md`, and explicit task or user restrictions take precedence over this guide. This guide never expands the permission boundary of a task.

The repository's mandatory agent workflow still applies to every requested change: the root writes a thorough pre-code implementation spec, delegates coding to the configured project implementer, reviews the actual combined diff, and runs the validation loop until the work passes. `FAST`, `STANDARD`, and `DEEP` calibrate depth only; no mode bypasses those requirements.

## Routing
Use one primary advisory role per task. Add a second advisory role only when needed.

- **Builder**: creates or changes web apps and APIs.
- **Device engineer**: ESP8266/ESP32, relay behavior, polling, reconnects, status reporting.
- **Server operator**: PM2, Windows startup, Cloudflare Tunnel, logs, backups, deployment.
- **Debugger**: reproduces and isolates failures before editing.
- **Security reviewer**: authentication, MCP, terminal, file access, secrets, public endpoints.
- **Reviewer**: verifies the diff is minimal, tested, understandable, and reversible.

Role instructions are in `docs/agents/` and task procedures are in `.codex/skills/`. Both the role briefs and task procedures are supplemental: they cannot replace or override the repository's mandatory workflow or the current task's permission boundary. Builder work maps to the configured project implementer.

## Fast, high-quality defaults
Start prompts with a mode:

- `FAST:` for a small, low-risk change.
- `STANDARD:` for a normal feature or bug.
- `DEEP:` for security, networking, deployment, data, MCP, terminal, or device-safety work.

A good prompt contains: outcome, location, constraints, acceptance checks, and permission boundary.

Example:

> FAST: Add a battery percentage badge to the lights page. Use the existing visual style. Do not change authentication or API formats. Test the page for missing battery data and summarize the files changed.

## Execution plans
For changes touching more than three files or involving deployment/data changes, update `docs/exec-plans/active.md` with:

- Goal
- Existing behavior
- Proposed changes
- Risks and rollback
- Validation
- Progress checklist

This execution plan is additional to the root's pre-code implementation spec. Preserve any unfinished plan or other existing work: never overwrite or delete it. Delete or archive a stale plan only when the work is confirmed complete and doing so is authorized.

## Recommended task sequence
1. Inspect only the files needed to understand the request.
2. Restate assumptions briefly.
3. Reproduce a bug or identify the exact integration points.
4. Make the smallest coherent change.
5. Run focused checks first; broaden checks when risk is high.
6. Review the diff for secrets, accidental data changes, and unrelated edits.
7. Give a concise completion report.

## Prompt library

### Build a new app
> STANDARD: Create a new app named `<name>` under `apps/`. Reuse `/topbar.js` and `/auth.js`, match the existing app style, and add only the minimum API routes required. Validate input and keep data isolated per user. Test the main flow and one invalid-input case.

### Fix a server problem
> STANDARD: Diagnose `<symptom>`. Inspect logs and reproduce before editing. Identify the root cause, make the smallest fix, and verify startup plus the affected endpoint. Do not refactor unrelated code.

### Add a smart device
> DEEP: Add support for `<device>`. Define a versioned device/API contract, offline behavior, retry/backoff, authentication, safe default state, and status reporting. Preserve existing lights devices. Include firmware and server validation steps.

### Review security
> DEEP: Threat-model the changed routes and review authentication, authorization, path traversal, command injection, request limits, secrets, and data exposure. Fix confirmed issues without breaking existing clients. Clearly separate verified findings from suggestions.

### Deploy
> DEEP: Prepare this change for the Windows server. Verify configuration, dependencies, backup needs, PM2 restart behavior, Cloudflare impact, health checks, and rollback. Do not expose secrets or overwrite live `data/`.

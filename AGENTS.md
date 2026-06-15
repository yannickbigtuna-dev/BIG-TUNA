# BIG-TUNA Codex Instructions

This is a live website repo. The live server machine auto-pulls from GitHub and updates the Cloudflare Tunnel site.

At the start of every session:

1. Run `git pull origin main` first.
2. Read `CODEX_CONTEXT.md` before making changes. It is the persistent project map for Codex.

For every requested change, use this agent workflow:

1. Start with the most capable available model acting as the architect and top-level coordinator.
2. The architect must inspect the request, gather the minimum required repo context, and write a thorough implementation spec before coding starts.
3. The spec must be detailed enough to serve as the acceptance and testing guide for a later validation pass.
4. The architect should delegate implementation work to cheaper sub-agents whenever practical, with clear task prompts derived from the spec.
5. After sub-agents report back, use the most capable available model again as the testing and validation agent.
6. The testing agent must verify the implementation against the architect's spec, check for regressions, and confirm the work behaves as intended.
7. If the implementation is incomplete, incorrect, or weak, send it back through a new sub-agent pass with specific feedback from the testing agent.
8. Repeat the implement -> report -> test -> feedback loop until the work meets the spec.

For every requested change:

1. Make the requested edits.
2. Update `CODEX_CONTEXT.md` in the same change if architecture, routes, data formats, deployment, app conventions, dependencies, security assumptions, or coding standards changed.
3. Run `git status` and `git diff`.
4. If the change is complete, commit with a clear message.
5. Push to main using `git push origin main`.
6. Tell the user what changed and that it was pushed.

Never commit:

- `.env` files
- passwords
- API keys
- `node_modules`
- local cache/build junk

Do not force push.
Do not rewrite history.
If there is a merge conflict, stop and explain it.


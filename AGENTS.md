# BIG-TUNA Codex Instructions

This is a live website repo. The live server machine auto-pulls from GitHub and updates the Cloudflare Tunnel site.

At the start of every session:

1. Run `git pull origin main` first.
2. Read `CODEX_CONTEXT.md` before making changes. It is the persistent project map for Codex.

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


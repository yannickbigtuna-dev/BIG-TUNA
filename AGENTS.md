# BIG-TUNA Codex Instructions

This is a live website repo. The live server machine auto-pulls from GitHub and updates the Cloudflare Tunnel site.

At the start of every session:

1. Run `git pull origin main` first.
2. Read `CODEX_CONTEXT.md` before making changes. It is the persistent project map for Codex.

For every requested change, use this agent workflow:

1. Keep the root thread on the most capable configured model. The root owns architecture, coordination, integration, and final review.
2. Before coding, the root must write a thorough implementation spec defining scope, constraints, file/module ownership, approach, and acceptance checks.
3. Split work into the smallest independent packages possible, each with a disjoint write scope.
4. Delegate coding to the project implementer agent. When at least two packages are independent, spawn all implementers in the same parallel round before waiting; parallel agents must never edit the same files.
5. Tell every implementer that it is not alone, must preserve concurrent edits, must stay within its ownership, and must report changed paths and checks run.
6. While agents run, the root does only useful non-overlapping work, then reviews the actual combined diff rather than trusting summaries.
7. Delegate independent acceptance checks to project tester agents in parallel when useful, but testers never replace root review.
8. The root performs final validation against the original spec and loops targeted implementation and testing until the work passes.

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


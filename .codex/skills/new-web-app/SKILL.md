---
name: new-web-app
description: Add a web app under the BIG-TUNA apps directory while following existing navigation, authentication, routing, validation, and per-user data-isolation conventions. Use when creating a new app or extending the server routes and launcher integration required by a new app.
---

# New Web App Skill

Use when adding an app under `apps/`.

1. Inspect two similar existing apps plus `topbar.js` and `auth.js`.
2. Define the smallest user flow and data contract.
3. Create `apps/<name>/index.html`; reuse shared navigation and authentication.
4. Add server routes only when needed. Enforce authentication and per-user isolation.
5. Validate and bound all input. Return consistent JSON errors.
6. Test authenticated use, unauthenticated use, invalid input, and refresh/reload behavior.
7. Confirm the app appears in the launcher without hard-coding unless the current architecture requires it.

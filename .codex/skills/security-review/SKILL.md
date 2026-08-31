---
name: security-review
description: Review BIG-TUNA changes for authentication, authorization, data isolation, injection, file-handling, secret-leakage, and public-exposure risks, then report evidence and fixes. Use for work involving auth, terminal or shell access, MCP, files or uploads, public APIs, Cloudflare exposure, deployment security, or an explicit security review.
---

# Security Review Skill

Use for auth, terminal, MCP, files, public APIs, and deployment exposure.

Check:
1. Authentication and authorization on every route.
2. User-to-user data isolation.
3. Path traversal and unsafe file names.
4. Command injection and shell argument handling.
5. Request body, upload, and rate limits.
6. Session expiry, token storage, and logout invalidation.
7. Secret leakage in code, logs, errors, and frontend assets.
8. Cloudflare/public exposure and least privilege.
9. CSRF/CORS assumptions where relevant.
10. Safe error messages that do not reveal internals.

Report severity, exploit path, evidence, minimal fix, and validation.

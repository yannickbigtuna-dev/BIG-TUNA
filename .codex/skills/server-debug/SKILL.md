---
name: server-debug
description: Diagnose and fix BIG-TUNA server failures through logs, focused reproduction, hypothesis testing, minimal root-cause changes, and targeted validation. Use for crashes, failed endpoints, startup failures, PM2 or server-log investigations, and other unexpected server behavior.
---

# Server Debug Skill

Use for crashes, failed endpoints, startup issues, and unexpected behavior.

1. Capture the exact symptom, URL/command, timestamp, and expected behavior.
2. Inspect PM2/server logs and the smallest relevant code path.
3. Reproduce locally or with a safe diagnostic request.
4. Test hypotheses before editing.
5. Implement the smallest root-cause fix.
6. Run syntax/startup checks and exercise the affected path plus one failure case.
7. Avoid touching live data; create a backup before any repair operation.

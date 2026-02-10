---
status: complete
priority: p1
issue_id: "039"
tags: [security, server, code-review]
dependencies: []
---

# No Global Express Error Handler

## Problem
Without a global error handler, unhandled Express errors would return default HTML error pages with stack traces, leaking internal server details to clients.

## Fix
Added `app.use((err, _req, res, _next) => ...)` error handler after all routes that logs the error server-side and returns a generic `{ error: 'Internal server error' }` to clients.

## Files Changed
- `server/src/main.ts` — added global error handler before `start()` function

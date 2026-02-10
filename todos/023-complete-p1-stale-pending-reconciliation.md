---
status: complete
priority: p1
issue_id: "023"
tags: [data-integrity, server, code-review]
dependencies: []
---

# No Reconciliation for Stale Pending Taps

## Problem
If the server crashes mid-tap, pending taps remain in `status='pending'` forever, permanently blocking those users from tapping again (rate limiter counts pending taps).

## Fix
Added `cleanStalePendingTaps()` method to TapTracker that marks pending taps older than 5 minutes as failed. Called at server startup.

## Files Changed
- `server/src/tapTracker.ts` — added `stmtCleanStalePending` and `cleanStalePendingTaps()` method
- `server/src/main.ts` — call `tapTracker.cleanStalePendingTaps()` after initialization

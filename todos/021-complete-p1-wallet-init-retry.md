---
status: complete
priority: p1
issue_id: "021"
tags: [bug, wallet, code-review]
dependencies: []
---

# Wallet initPromise Never Resets on Failure

## Problem
If `doInit()` rejected, `initPromise` remained set to the rejected promise. All subsequent calls to `initWallet()` would immediately reject without retrying.

## Fix
Added `.catch()` handler that sets `initPromise = null` before re-throwing, allowing future calls to retry initialization.

## Files Changed
- `src/wallet.ts` — added catch-and-reset in `initWallet()`

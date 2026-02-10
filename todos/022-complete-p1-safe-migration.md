---
status: complete
priority: p1
issue_id: "022"
tags: [data-integrity, database, code-review]
dependencies: []
---

# Destructive DROP TABLE in Migration

## Problem
When detecting an incompatible taps table schema, the migration ran `DROP TABLE taps` which destroys all historical data irreversibly.

## Fix
Replaced with `ALTER TABLE taps RENAME TO taps_backup_{timestamp}`. Logs the row count and backup table name for recovery if needed.

## Files Changed
- `server/src/db.ts` — safe rename instead of drop

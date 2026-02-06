---
status: pending
priority: p2
issue_id: "007"
tags: [security, code-review, server, compliance]
dependencies: []
---

# No Audit Logging for Tap Transactions

## Problem Statement

The server processes financial transactions (bitcoin rewards) but logs nothing that could be used for forensic audit, fraud detection, or compliance reporting.

**Why it matters:** If a user disputes a transaction or a venue reports suspicious patterns, there's no audit trail to investigate.

## Findings

- **Location:** `server/src/main.ts` (entire POST /tap handler)
- **Current behavior:** Only errors logged to stderr, no persistent audit
- **Missing:** timestamp, user address, venue, result, IP for each tap

## Proposed Solutions

### Option A: Audit Log Table in SQLite (Recommended)
- Create `audit_logs` table
- Log every /tap request with full context
- Admin endpoint to query logs

**Pros:** Simple, uses existing database
**Cons:** Grows database size
**Effort:** Medium
**Risk:** Low

### Option B: Structured Logging to File
- JSON logs to separate audit file
- Include request ID for tracing
- Rotate logs daily

**Pros:** Doesn't affect main database
**Cons:** Harder to query, need log management
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option A — audit table in SQLite for easy querying.

## Technical Details

**Schema:**
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  user_ark_address TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  nfc_tag_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  result TEXT NOT NULL,  -- 'success', 'rate_limited', 'error'
  error_message TEXT,
  txid TEXT,
  created_at INTEGER NOT NULL
);
```

**Affected files:**
- `server/src/db.ts` — add audit_logs table
- `server/src/main.ts` — log before/after each tap
- `server/src/tapTracker.ts` — add audit methods

## Acceptance Criteria

- [ ] Every /tap request logged to audit_logs table
- [ ] Logs include: timestamp, user, venue, result, IP, error (if any)
- [ ] GET /admin/audit endpoint to query logs
- [ ] Tests verify logs created on success & failure

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Financial systems need audit trails |

## Resources

- Tap endpoint: `server/src/main.ts:277-301`

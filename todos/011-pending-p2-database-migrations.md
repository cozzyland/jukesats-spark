---
status: pending
priority: p2
issue_id: "011"
tags: [infrastructure, code-review, server, database]
dependencies: []
---

# Fragile Database Migration Pattern

## Problem Statement

On startup, code checks if old table schema exists and drops it if incompatible. No version tracking, no migration history, no rollback capability.

**Why it matters:** Adding new columns requires careful manual schema migration. High risk of data loss.

## Findings

- **Location:** `server/src/db.ts` lines 11-20
- **Current pattern:** Check columns, drop table if incompatible
- **Missing:** Version tracking, migration history, rollback

```typescript
// Current - one-time check, no versioning
if (tableExists) {
  const columns = db.pragma('table_info(taps)')
  if (!columnNames.has('user_ark_address')) {
    db.exec(`DROP TABLE taps`)  // Drops all data!
  }
}
```

## Proposed Solutions

### Option A: Simple Version Table (Recommended)
- Track schema version in `db_version` table
- Numbered migration files
- Run migrations in order at startup

**Pros:** Simple, no dependencies
**Cons:** Must write migration runner
**Effort:** Medium
**Risk:** Low

### Option B: Use Migration Library
- Use `better-sqlite3-migrations` or similar
- Managed migration lifecycle

**Pros:** Battle-tested
**Cons:** Additional dependency
**Effort:** Low
**Risk:** Low

## Recommended Action

Option A — keeps dependencies minimal, full control.

## Technical Details

**Migration system:**
```typescript
// server/src/migrations/001_create_taps_table.ts
export const migration = {
  version: 1,
  up: (db) => db.exec(`CREATE TABLE taps (...)`),
  down: (db) => db.exec(`DROP TABLE taps`)
}

// server/src/db.ts
function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS db_version (version INTEGER)`)
  const current = db.prepare(`SELECT version FROM db_version`).get()?.version ?? 0

  for (const migration of allMigrations) {
    if (migration.version > current) {
      migration.up(db)
      db.prepare(`INSERT OR REPLACE INTO db_version VALUES (?)`).run(migration.version)
    }
  }
}
```

## Acceptance Criteria

- [ ] Schema version tracked in database
- [ ] Migrations stored as versioned files
- [ ] Migrations run automatically at startup
- [ ] Tests verify migrations apply correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Schema changes need proper versioning |

## Resources

- Current schema logic: `server/src/db.ts:11-20`

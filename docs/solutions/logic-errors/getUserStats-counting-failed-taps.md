---
title: "getUserStats Counting Failed Taps"
category: logic-errors
tags: [database, sqlite, server, data-integrity, code-review]
module: server
symptoms:
  - User stats show inflated tap counts
  - Stamp card shows more stamps than actual successful taps
  - totalRewardsSats includes rewards from failed transactions
date_solved: "2026-02-10"
---

# getUserStats Counting Failed Taps

## Symptom

User statistics (total taps, total rewards, venues visited) were inflated because the queries counted ALL tap records, including those with `status = 'failed'` or `status = 'pending'`.

## Root Cause

In `server/src/tapTracker.ts`, two prepared statements lacked a status filter:

```sql
-- stmtUserStats (buggy)
SELECT COUNT(*) as totalTaps, COALESCE(SUM(reward_sats), 0) as totalRewardsSats, MAX(created_at) as lastTap
FROM taps WHERE user_ark_address = ?

-- stmtUserVenues (buggy)
SELECT DISTINCT venue_id FROM taps WHERE user_ark_address = ?
```

The `taps` table has a `status` column with values: `'pending'`, `'completed'`, `'failed'`. Only `'completed'` taps represent actual successful rewards.

## Solution

Add `AND status = 'completed'` to both queries:

```sql
-- stmtUserStats (fixed)
SELECT COUNT(*) as totalTaps, COALESCE(SUM(reward_sats), 0) as totalRewardsSats, MAX(created_at) as lastTap
FROM taps WHERE user_ark_address = ? AND status = 'completed'

-- stmtUserVenues (fixed)
SELECT DISTINCT venue_id FROM taps WHERE user_ark_address = ? AND status = 'completed'
```

Also added a dedicated `stmtUserTapCount` for the public-facing stamp card endpoint:

```sql
SELECT COUNT(*) as count FROM taps WHERE user_ark_address = ? AND status = 'completed'
```

## Prevention

- When querying the `taps` table for user-facing data, always filter by `status = 'completed'`
- Rate-limiting queries correctly use `status != 'failed'` (pending taps should block rate limits)
- Admin/debug queries may want all statuses — document the intent explicitly

## Related

- Server file: `server/src/tapTracker.ts`
- The `stmtTodaySpend` query already had `AND status != 'failed'` — inconsistency between queries was the signal

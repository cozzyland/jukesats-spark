---
status: complete
priority: p1
issue_id: "024"
tags: [bug, nfc, code-review]
dependencies: []
---

# Tag Validation Uses Global Count Instead of Per-Venue

## Problem
`isValidTag` checked global tag count across all venues. If venue-A had tags registered, venue-B (with no tags) would also enforce tag validation, rejecting all taps.

## Fix
Changed `stmtTagCount` query to `WHERE venue_id = ?` so each venue independently decides whether to enforce tag validation (open mode when no tags registered for that venue).

## Files Changed
- `server/src/tapTracker.ts` — scoped tag count query per-venue, updated `isValidTag` to pass venueId

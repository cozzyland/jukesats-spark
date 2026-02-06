---
status: complete
priority: p1
issue_id: "001"
tags: [security, code-review, nfc]
dependencies: []
---

# NFC Tag Validation Missing

## Problem Statement

The server accepts `nfcTagId` from the client but never validates it against registered tags. Anyone can submit arbitrary tag IDs and receive rewards without physical NFC contact.

**Why it matters:** This is a critical security vulnerability that allows unlimited reward theft via scripted fake taps.

## Findings

- **Location:** `server/src/main.ts` lines 278-292
- **Current behavior:** `nfcTagId` is stored in database but never verified
- **Attack vector:** `curl -X POST /tap -d '{"userArkAddress":"...", "venueId":"cafe-1", "nfcTagId":"fake123"}'` receives rewards

```typescript
// Current code - NO VALIDATION
const { userArkAddress, venueId, nfcTagId } = req.body
if (!userArkAddress || !venueId || !nfcTagId) {
  return res.status(400).json({ error: 'Missing required fields' })
}
// nfcTagId is never checked against venue's registered tags
```

## Proposed Solutions

### Option A: Database Tag Registry (Recommended)
- Create `nfc_tags` table with columns: `id`, `tag_id`, `venue_id`, `created_at`, `active`
- Validate `(venue_id, nfc_tag_id)` pair exists before processing tap
- Admin endpoint to register/deactivate tags

**Pros:** Simple, works with any NFC tag
**Cons:** Tags can still be cloned if attacker reads the URL
**Effort:** Medium
**Risk:** Low

### Option B: Cryptographic Tag Signing
- NFC tags contain HMAC signature: `/tap?venue=X&tag=Y&sig=HMAC(secret, venue+tag+timestamp)`
- Server validates signature before processing
- Signatures expire after short window (prevents replay)

**Pros:** Tags cannot be spoofed even if URL is known
**Cons:** Requires special tag programming, timestamp coordination
**Effort:** High
**Risk:** Medium (clock skew issues)

### Option C: Rate Limit Per Tag (Minimal)
- Add per-tag rate limiting (1 tap per tag per hour)
- Doesn't prevent spoofing but limits damage

**Pros:** Simple to implement
**Cons:** Doesn't actually solve the problem, just mitigates
**Effort:** Low
**Risk:** Low

## Recommended Action

Option A (Database Tag Registry) — provides good security without complexity. Can add Option B later if tag cloning becomes a real problem.

## Technical Details

**Affected files:**
- `server/src/db.ts` — add `nfc_tags` table
- `server/src/main.ts` — add validation in `processTap()`
- `server/src/tapTracker.ts` — add `isValidTag(venueId, tagId)` method

**Database schema:**
```sql
CREATE TABLE nfc_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(tag_id, venue_id)
);
CREATE INDEX idx_nfc_tags_venue ON nfc_tags(venue_id, tag_id);
```

## Acceptance Criteria

- [ ] `nfc_tags` table exists with proper schema
- [ ] `/tap` rejects unknown `(venue_id, nfc_tag_id)` pairs with 400
- [ ] Admin endpoint to register new tags: `POST /admin/tags`
- [ ] Admin endpoint to list/deactivate tags: `GET/DELETE /admin/tags`
- [ ] Tests verify tag validation works
- [ ] Existing tests still pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Critical security gap identified |

## Resources

- Server tap endpoint: `server/src/main.ts:278-292`
- Plan document: `docs/plans/2026-02-01-feat-react-native-nfc-tap-to-earn-app-plan.md`

---
status: pending
priority: p2
issue_id: "010"
tags: [feature, code-review, server, ux]
dependencies: []
---

# No User Tap History Endpoint

## Problem Statement

Users cannot view their own tap history. Only admin can see stats via `/stats/:userArkAddress`. This makes it hard for users to verify their earnings.

**Why it matters:** Users need to trust that rewards were received. Without history, they can't verify.

## Findings

- **Location:** `server/src/main.ts` lines 306-310
- **Current:** Only admin endpoint exists
- **Missing:** Public endpoint for users to see their own history

## Proposed Solutions

### Option A: Public User History Endpoint (Recommended)
- `GET /user/:address/history` (no auth needed)
- Returns user's own tap history
- Limited to last 30 days or 100 records

**Pros:** Simple, transparent
**Cons:** Anyone can query any address (privacy consideration)
**Effort:** Low
**Risk:** Low (addresses are pseudonymous anyway)

### Option B: Signed Request
- User signs request with wallet key
- Only wallet owner can view history

**Pros:** Privacy protected
**Cons:** Complex, requires client signing
**Effort:** High
**Risk:** Medium

## Recommended Action

Option A — addresses are already public on ARK network, no privacy loss.

## Technical Details

**New endpoint:**
```typescript
app.get('/user/:userArkAddress/history', async (req, res) => {
  const { userArkAddress } = req.params
  const history = tapTracker.getUserHistory(userArkAddress, 100)  // Last 100 taps
  res.json({ history })
})
```

**Response format:**
```json
{
  "history": [
    { "timestamp": 1234567890, "venue": "cafe-1", "amount": 330, "status": "completed" },
    { "timestamp": 1234567800, "venue": "cafe-2", "amount": 330, "status": "completed" }
  ]
}
```

## Acceptance Criteria

- [ ] Public endpoint returns user's tap history
- [ ] Limited to reasonable number of records
- [ ] Returns timestamp, venue, amount, status

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Transparency builds trust |

## Resources

- Stats endpoint: `server/src/main.ts:306-310`

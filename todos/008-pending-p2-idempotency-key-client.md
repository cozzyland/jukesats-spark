---
status: pending
priority: p2
issue_id: "008"
tags: [bug, code-review, mobile-app, reliability]
dependencies: []
---

# Client Doesn't Send Idempotency Key

## Problem Statement

Server accepts optional `Idempotency-Key` header for deduplication, but the mobile app never sends it. This makes retries unsafe — if network fails after tap completes but before response arrives, user retrying gets double-charged.

**Why it matters:** Users can accidentally receive double rewards on network errors.

## Findings

- **Location:** `App.tsx` lines 52-75 (submitTap function)
- **Server support:** `server/src/main.ts:289` accepts Idempotency-Key header
- **Client omission:** No header sent in fetch request

```typescript
// Current client code - NO IDEMPOTENCY KEY
const res = await fetch(`${API_URL}/tap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userArkAddress, venueId, nfcTagId }),
})
```

## Proposed Solutions

### Option A: Generate UUID Per Tap (Recommended)
- Generate UUID for each tap attempt
- Include as Idempotency-Key header
- Server deduplicates based on key

**Pros:** Simple, standard approach
**Cons:** Need UUID generation in app
**Effort:** Low
**Risk:** Low

### Option B: Hash of Tap Parameters + Timestamp Window
- Create key from `hash(venue + tag + timestamp_minute)`
- Same tap within 1 minute deduped automatically

**Pros:** Deterministic, no UUID needed
**Cons:** Window-based, may have edge cases at boundaries
**Effort:** Low
**Risk:** Low

## Recommended Action

Option A — UUID is cleaner and more standard.

## Technical Details

**Fix in App.tsx:**
```typescript
async function submitTap(
  userArkAddress: string,
  venueId: string,
  nfcTagId: string
): Promise<TapResult> {
  const idempotencyKey = crypto.randomUUID()  // or use expo-crypto

  const res = await fetch(`${API_URL}/tap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ userArkAddress, venueId, nfcTagId }),
  })
  // ...
}
```

**Note:** May need to use `expo-crypto` for `randomUUID()` in React Native.

## Acceptance Criteria

- [ ] App sends Idempotency-Key header on every /tap request
- [ ] Server deduplicates correctly (test: retry returns same txid)
- [ ] Double-tap with network retry doesn't double-charge

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Idempotency prevents double-spend on retries |

## Resources

- Client submitTap: `App.tsx:52-75`
- Server idempotency: `server/src/main.ts:289`

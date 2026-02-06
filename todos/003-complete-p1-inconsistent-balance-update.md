---
status: complete
priority: p1
issue_id: "003"
tags: [bug, code-review, mobile-app, ux]
dependencies: []
---

# Inconsistent Balance Update After Tap

## Problem Statement

After a successful tap, the app shows different balance values depending on whether it was a cold start or warm deep link:
- **Cold start path:** Sets `balance: 0` (wrong)
- **Warm path:** Fetches actual balance (correct)

**Why it matters:** Users see "+330 sats!" but balance shows 0, causing confusion about whether reward was received.

## Findings

- **Location:** `App.tsx` lines 171-187 vs 189-216
- **Cold start:** `handleTapResult()` at line 174 sets `balance: 0`
- **Warm link:** `handleTap()` at line 195 calls `getBalance()` first

```typescript
// Cold start path - WRONG
function handleTapResult(tapResult: TapResult, addr: string) {
  if (tapResult.success) {
    setState({
      kind: 'tapSuccess',
      balance: 0,  // <- Always 0, never fetches real balance
      address: addr,
      reward: tapResult.amount || REWARD_SATS,
    })
  }
}

// Warm path - CORRECT
async function handleTap(venueId: string, tagId: string) {
  const result = await submitTap(addr, venueId, tagId)
  if (result.success) {
    const balance = await getBalance()  // <- Fetches real balance
    setState({
      kind: 'tapSuccess',
      balance,
      // ...
    })
  }
}
```

## Proposed Solutions

### Option A: Fetch Balance in handleTapResult (Recommended)
- Make `handleTapResult` async
- Fetch balance before setting state
- Unifies both code paths

**Pros:** Simple fix, consistent behavior
**Cons:** Adds latency to cold start success display
**Effort:** Low
**Risk:** Low

### Option B: Use Cached Balance + Background Refresh
- Show cached balance immediately (from AsyncStorage)
- Refresh in background after overlay appears
- Update display when refresh completes

**Pros:** Faster perceived response
**Cons:** More complex, may show stale balance briefly
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option A — simplest fix, consistent UX.

## Technical Details

**Fix:**
```typescript
async function handleTapResult(tapResult: TapResult, addr: string) {
  if (tapResult.success) {
    const balance = await getBalance()  // Add this line
    setState({
      kind: 'tapSuccess',
      balance,  // Use fetched balance
      address: addr,
      reward: tapResult.amount || REWARD_SATS,
    })
  }
  // ... rest unchanged
}
```

**Affected files:**
- `App.tsx` — modify `handleTapResult()` function

## Acceptance Criteria

- [ ] Cold start tap shows correct balance after success
- [ ] Warm link tap shows correct balance after success
- [ ] Both paths use same balance-fetching logic
- [ ] Test on simulator with deep link

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Code duplication led to inconsistent behavior |

## Resources

- App.tsx: `App.tsx:171-216`

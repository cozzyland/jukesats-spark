---
status: complete
priority: p1
issue_id: "006"
tags: [bug, code-review, server, memory]
dependencies: []
---

# Memory Leak in Fund Listener setTimeout Loop

## Problem Statement

The `listenForIncomingFunds()` method creates orphaned `setTimeout` callbacks that accumulate indefinitely. Each incoming fund event spawns a new timer that's never cleaned up.

**Why it matters:** Server memory usage grows unbounded over time, eventually causing OOM crashes.

## Findings

- **Location:** `server/src/hotWallet.ts` lines 99-139
- **Issue:** `setTimeout` callbacks accumulate without cleanup

```typescript
while (true) {
  try {
    const incoming = await waitForIncomingFunds(this.wallet)
    const balance = await this.wallet.getBalance()

    // This setTimeout creates orphaned async operation
    setTimeout(async () => {
      if (!this.wallet) return
      const refreshedBalance = await this.wallet.getBalance()  // Never awaited
    }, 5000)

  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, backoffMs))
    backoffMs = Math.min(backoffMs * 2, 60_000)
  }
}
```

**Problems:**
1. Each `setTimeout` callback is never awaited or tracked
2. No cancellation mechanism for graceful shutdown
3. If server receives SIGTERM, loop continues
4. Memory for promise chains accumulates

## Proposed Solutions

### Option A: Remove Redundant Refresh (Recommended)
- The 5-second delayed refresh is likely unnecessary
- Just log the balance once after incoming funds
- Eliminates the setTimeout entirely

**Pros:** Simplest fix, removes the problem
**Cons:** Loses the "double-check" behavior (but was it needed?)
**Effort:** Low
**Risk:** Low

### Option B: Track and Cleanup Timers
- Store timer references in array
- Clear all timers on shutdown
- Add cancellation token to while loop

**Pros:** Keeps refresh behavior
**Cons:** More complex, may still have edge cases
**Effort:** Medium
**Risk:** Low

### Option C: Use setInterval Instead
- Single interval for periodic balance refresh
- Easier to manage lifecycle
- Clear on shutdown

**Pros:** Simpler lifecycle management
**Cons:** May refresh when not needed
**Effort:** Low
**Risk:** Low

## Recommended Action

Option A — remove the setTimeout entirely. The immediate balance fetch is sufficient.

## Technical Details

**Fix:**
```typescript
while (true) {
  try {
    const incoming = await waitForIncomingFunds(this.wallet)
    const balance = await this.wallet.getBalance()
    console.log(`[HotWallet] Received ${incoming.value} sats, new balance: ${balance.available}`)
    // Remove the setTimeout entirely
  } catch (error) {
    console.error('[HotWallet] Error in fund listener:', error)
    await new Promise(resolve => setTimeout(resolve, backoffMs))
    backoffMs = Math.min(backoffMs * 2, 60_000)
  }
}
```

**Also add shutdown support:**
```typescript
private abortController = new AbortController()

async listenForIncomingFunds() {
  while (!this.abortController.signal.aborted) {
    // ... existing logic
  }
}

shutdown() {
  this.abortController.abort()
}
```

**Affected files:**
- `server/src/hotWallet.ts` — fix listener loop

## Acceptance Criteria

- [ ] No orphaned setTimeout callbacks created
- [ ] Memory usage stays stable over time
- [ ] Graceful shutdown stops the listener loop
- [ ] Existing functionality (balance logging) preserved

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Infinite loops need shutdown mechanisms |

## Resources

- Fund listener: `server/src/hotWallet.ts:99-139`

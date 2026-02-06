---
status: pending
priority: p1
issue_id: "005"
tags: [performance, code-review, server, scalability]
dependencies: []
---

# Global Mutex Creates Bottleneck Under Load

## Problem Statement

All tap processing goes through a single global `Mutex` that serializes rate-limit checks and INSERT operations. Under load, this creates head-of-line blocking where users wait for other users' taps to complete.

**Why it matters:** At 10 taps/second, average user waits 500ms+ just for mutex lock. This limits throughput and degrades UX.

## Findings

- **Location:** `server/src/main.ts` lines 42-54, 188-256
- **Current behavior:** All taps acquire same mutex, process sequentially

```typescript
const release = await tapMutex.acquire()  // <- Wait for global lock
try {
  // Check venue whitelist (~0ms)
  // Check IP rate limit (~1ms SQLite query)
  // Check per-address rate limiting (~1ms)
  // Check daily spend cap (~1ms)
  // INSERT pending tap (~1ms)
} finally {
  release()
}
// Then send reward (outside mutex, ~100-500ms)
```

**Bottleneck analysis:**
- User A tap arrives → acquires mutex → runs checks (4ms) → release
- User B arrives → waits 4ms → acquires → runs checks → release
- User 10 arrives → waits ~36ms just for mutex

## Proposed Solutions

### Option A: Per-User Mutex Map (Recommended)
- Create mutex per user address instead of global
- Different users can tap concurrently
- Same user still serialized (prevents double-tap)

**Pros:** Removes cross-user blocking, maintains same-user safety
**Cons:** Memory for mutex map, cleanup needed
**Effort:** Medium
**Risk:** Low

### Option B: Optimistic Concurrency Control
- Remove mutex entirely
- Use database constraints (UNIQUE on idempotency_key)
- Retry on constraint violation

**Pros:** Maximum concurrency, simpler code
**Cons:** Requires careful error handling, potential retry storms
**Effort:** Medium
**Risk:** Medium

### Option C: Read-Check Outside Mutex, Write Inside
- Do rate-limit reads outside mutex (may have stale data)
- Only acquire mutex for the INSERT
- Accept small race window

**Pros:** Reduces mutex hold time significantly
**Cons:** Slight race condition on rate limits
**Effort:** Low
**Risk:** Low (acceptable for rate limiting)

## Recommended Action

Option A (per-user mutex) for best balance of safety and performance.

## Technical Details

**Per-user mutex implementation:**
```typescript
class MutexMap {
  private locks = new Map<string, Promise<void>>()

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key)
    }
    let release: () => void
    const promise = new Promise<void>(r => { release = r })
    this.locks.set(key, promise)
    return () => {
      this.locks.delete(key)
      release!()
    }
  }
}

const userMutex = new MutexMap()

// In processTap:
const release = await userMutex.acquire(userArkAddress)
```

**Affected files:**
- `server/src/main.ts` — replace global mutex with per-user

## Acceptance Criteria

- [ ] Different users can tap concurrently without waiting
- [ ] Same user's concurrent taps are still serialized
- [ ] Existing concurrency tests still pass
- [ ] Load test shows improved throughput (10+ taps/second)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Global locks don't scale |

## Resources

- Mutex implementation: `server/src/main.ts:42-54`
- processTap function: `server/src/main.ts:188-256`

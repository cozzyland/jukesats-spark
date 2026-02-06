---
status: pending
priority: p3
issue_id: "014"
tags: [reliability, code-review, mobile-app]
dependencies: []
---

# No Request Timeout in Mobile App

## Problem Statement

`submitTap()` fetch has no timeout. App could hang forever if server is unresponsive.

## Findings

- **Location:** `App.tsx` lines 57-61
- **Missing:** AbortController with timeout

## Recommended Action

Add 30-second timeout:

```typescript
async function submitTap(...) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(`${API_URL}/tap`, {
      signal: controller.signal,
      // ...
    })
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}
```

## Acceptance Criteria

- [ ] Tap requests timeout after 30 seconds
- [ ] Timeout shows error to user, not hang

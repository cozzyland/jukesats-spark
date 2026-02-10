---
status: complete
priority: p1
issue_id: "016"
tags: [bug, react, code-review]
dependencies: []
---

# Stale Closure in Deep Link Listener

## Problem
The `useEffect` for warm deep links captured `handleTap` in a closure that became stale when state changed. The dependency array `[state.kind]` caused re-subscription but didn't guarantee the latest `handleTap` reference.

## Fix
Added `useRef` pattern — `handleTapRef.current` always points to the latest `handleTap` function. The listener subscribes once (`[]` deps) and calls via the ref.

## Files Changed
- `App.tsx` — added `useRef` import, `handleTapRef`, updated deep link useEffect

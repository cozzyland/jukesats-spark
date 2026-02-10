---
status: complete
priority: p1
issue_id: "018"
tags: [security, validation, code-review]
dependencies: []
---

# submitTap Blindly Casts Response

## Problem
`submitTap` did `return res.json()` without validating the response shape, trusting the server to always return a valid `TapResult`.

## Fix
Added `.catch(() => null)` on `res.json()` and validated `body.success` is a boolean before casting to `TapResult`.

## Files Changed
- `App.tsx` — added response validation in `submitTap`

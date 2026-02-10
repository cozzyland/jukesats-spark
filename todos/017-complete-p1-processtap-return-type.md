---
status: complete
priority: p1
issue_id: "017"
tags: [typescript, code-review, server]
dependencies: []
---

# processTap Lacks Explicit Return Type

## Problem
`processTap` had no return type annotation — TypeScript inferred a complex union that wasn't checked at call sites.

## Fix
Added `TapSuccess | TapFailure` discriminated union types and annotated `processTap` with `Promise<TapResult>`.

## Files Changed
- `server/src/main.ts` — added type definitions and return type annotation

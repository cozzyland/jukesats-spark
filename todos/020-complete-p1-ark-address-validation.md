---
status: complete
priority: p1
issue_id: "020"
tags: [security, validation, code-review]
dependencies: []
---

# Weak ARK Address Validation

## Problem
Both client and server only checked address prefix (`startsWith('ark1')` / `startsWith('tark1')`), accepting any string with that prefix regardless of length or character set.

## Fix
Replaced with regex `^(t?ark1)[a-z0-9]{20,100}$` on both client (`QRSendScreen.tsx`) and server (`main.ts`). Validates prefix, charset (lowercase alphanumeric), and length bounds.

## Files Changed
- `src/QRSendScreen.tsx` — `looksLikeArkAddress` now uses regex
- `server/src/main.ts` — added `ARK_ADDRESS_RE` constant, replaced both prefix checks

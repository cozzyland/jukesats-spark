---
status: pending
priority: p3
issue_id: "015"
tags: [documentation, code-review]
dependencies: []
---

# Missing JSDoc Documentation

## Problem Statement

Core functions like `processTap()`, `sendReward()`, `canTap()` lack documentation on error cases, preconditions, or return value semantics.

## Findings

- **Location:** Throughout server and app code
- **Missing:** JSDoc comments on public functions

## Recommended Action

Add JSDoc to key functions:

```typescript
/**
 * Process a tap request, validating rate limits and sending reward.
 * @param userArkAddress - User's ARK wallet address
 * @param venueId - Venue identifier from NFC tag
 * @param nfcTagId - NFC tag identifier
 * @param ip - Client IP address for rate limiting
 * @param idempotencyKey - Optional key to prevent duplicate processing
 * @returns ProcessTapResult with success status and txid or error
 * @throws Never - all errors returned in result object
 */
async function processTap(...): Promise<ProcessTapResult>
```

## Acceptance Criteria

- [ ] Public functions have JSDoc comments
- [ ] Error cases documented
- [ ] Return values explained

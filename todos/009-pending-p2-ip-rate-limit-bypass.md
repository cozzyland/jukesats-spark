---
status: pending
priority: p2
issue_id: "009"
tags: [security, code-review, server]
dependencies: []
---

# IP Rate Limiting Easily Bypassed

## Problem Statement

Rate limiting only uses client IP (`req.ip`). This can be easily bypassed using VPNs, proxies, or botnets with distributed IPs.

**Why it matters:** Attackers can create unlimited wallets and drain the hot wallet despite IP rate limits.

## Findings

- **Location:** `server/src/tapTracker.ts` lines 110-123
- **Current behavior:** 10 taps per IP per hour
- **Bypass methods:** VPN rotation, proxy chains, botnet

## Proposed Solutions

### Option A: Device Fingerprinting (Recommended)
- Require device fingerprint header from app
- Rate limit per fingerprint in addition to IP
- Harder to spoof than IP alone

**Pros:** Much harder to bypass
**Cons:** Privacy implications, can be spoofed with effort
**Effort:** Medium
**Risk:** Low

### Option B: Proof of Work
- Require client to solve small PoW puzzle
- Adds cost to each tap request
- Slows down automated attacks

**Pros:** Economic deterrent to Sybil attacks
**Cons:** Drains mobile battery, poor UX
**Effort:** High
**Risk:** Medium

### Option C: Phone Number Verification
- Require SMS verification for new wallets
- One phone = one wallet
- Very strong Sybil resistance

**Pros:** Very effective
**Cons:** Privacy, cost, friction
**Effort:** High
**Risk:** Medium

## Recommended Action

Option A as enhancement. Combined with NFC tag validation (TODO-001), the attack surface is significantly reduced.

## Technical Details

**Device fingerprint approach:**
```typescript
// Client sends X-Device-Fingerprint header
// Server stores fingerprint_taps table
// Rate limit: 10 taps per fingerprint per hour
```

**Note:** This is a defense-in-depth measure. NFC tag validation (TODO-001) is higher priority because it addresses the root cause.

## Acceptance Criteria

- [ ] Additional rate limiting beyond IP
- [ ] Documented bypass resistance analysis
- [ ] Tests verify fingerprint rate limiting

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Defense in depth needed |

## Resources

- IP rate limiting: `server/src/tapTracker.ts:110-123`

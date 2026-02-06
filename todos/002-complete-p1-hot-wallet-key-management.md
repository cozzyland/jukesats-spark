---
status: complete
priority: p1
issue_id: "002"
tags: [security, code-review, infrastructure]
dependencies: []
---

# Hot Wallet Private Key in Environment Variable

## Problem Statement

The hot wallet's private key is loaded directly from `HOT_WALLET_PRIVATE_KEY` environment variable. This is dangerous because env vars can be exposed in process listings, container logs, error stack traces, and deployment dashboards.

**Why it matters:** If the server is compromised, attacker gains direct access to all Bitcoin in the hot wallet.

## Findings

- **Location:** `server/src/hotWallet.ts` lines 27-33
- **Current behavior:** Private key read from env var at startup
- **Code comment acknowledges risk:** "In production, the private key should come from a secure vault/HSM"

```typescript
// Current code
const privateKeyHex = process.env.HOT_WALLET_PRIVATE_KEY
if (!privateKeyHex) {
  throw new Error('HOT_WALLET_PRIVATE_KEY environment variable required')
}
```

## Proposed Solutions

### Option A: Fly.io Secrets (Quick Win)
- Use `fly secrets set` instead of env vars in `fly.toml`
- Secrets are encrypted at rest and not logged

**Pros:** Zero code changes, immediate improvement
**Cons:** Still in memory at runtime
**Effort:** Low
**Risk:** Low

### Option B: HashiCorp Vault / AWS Secrets Manager
- Fetch private key from secrets manager at startup
- Key never in env vars or config files
- Can rotate keys without redeployment

**Pros:** Industry standard, audit trail, rotation support
**Cons:** Additional infrastructure dependency
**Effort:** Medium
**Risk:** Low

### Option C: Hardware Security Module (HSM)
- Private key never leaves HSM
- Signing operations happen on HSM
- Requires ARK SDK support for external signers

**Pros:** Maximum security
**Cons:** Expensive, complex, may not be supported by ARK SDK
**Effort:** High
**Risk:** Medium (SDK compatibility)

## Recommended Action

Option A immediately (Fly.io secrets), then Option B for production at scale.

## Technical Details

**For Option A (immediate):**
```bash
# Remove from fly.toml [env] section
# Instead use:
fly secrets set HOT_WALLET_PRIVATE_KEY=<key>
```

**For Option B:**
- Add `@aws-sdk/client-secrets-manager` or `node-vault` dependency
- Create `server/src/secrets.ts` to fetch secrets at startup
- Update `hotWallet.ts` to use secrets service

## Acceptance Criteria

- [ ] Private key NOT in `fly.toml` or any config file
- [ ] Private key loaded from Fly.io secrets or external vault
- [ ] Startup fails gracefully if secret unavailable
- [ ] No private key appears in logs or error messages

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Env var exposure is common attack vector |

## Resources

- Hot wallet init: `server/src/hotWallet.ts:27-33`
- Fly.io secrets docs: https://fly.io/docs/reference/secrets/

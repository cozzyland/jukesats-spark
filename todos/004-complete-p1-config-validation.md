---
status: complete
priority: p1
issue_id: "004"
tags: [reliability, code-review, server]
dependencies: []
---

# No Config Validation at Server Startup

## Problem Statement

Critical environment variables are parsed but never validated at startup. Server can start with broken configuration and fail later during operation.

**Why it matters:** Misconfigured production deployment may pass health checks but fail on first real tap, causing silent failures that are hard to debug.

## Findings

- **Location:** `server/src/main.ts` lines 56-63
- **Affected configs:** `DEFAULT_REWARD_SATS`, `TAP_COOLDOWN_MS`, `ADMIN_TOKEN`, `DAILY_SPEND_CAP_SATS`, `IP_RATE_LIMIT_MAX`, `DB_PATH`

**Current issues:**
- `ADMIN_TOKEN` empty string → admin endpoints still "work" (insecure)
- `DEFAULT_REWARD_SATS` negative/NaN → silent failure, users get 0 sats
- `DAILY_SPEND_CAP_SATS` negative → cap ignored silently
- `TAP_COOLDOWN_MS` = 0 → rate limiting disabled
- `DB_PATH` invalid → crash on first tap, not at startup

```typescript
// Current code - NO VALIDATION
const DEFAULT_REWARD_SATS = parseInt(process.env.DEFAULT_REWARD_SATS || '330', 10)
const TAP_COOLDOWN_MS = parseInt(process.env.TAP_COOLDOWN_MS || '60000', 10)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
// ... these could all be invalid
```

## Proposed Solutions

### Option A: Inline Validation with Throws (Recommended)
- Add validation checks after each config parse
- Throw descriptive error if invalid
- Server refuses to start with bad config

**Pros:** Simple, fail-fast, clear error messages
**Cons:** Validation logic scattered in main.ts
**Effort:** Low
**Risk:** Low

### Option B: Config Module with Schema
- Create `server/src/config.ts` with typed interface
- Use schema validation library (zod, joi)
- Single source of truth for all config

**Pros:** Type-safe, reusable, self-documenting
**Cons:** Additional dependency, more setup
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option A for quick fix, consider Option B when adding more config.

## Technical Details

**Quick fix for main.ts:**
```typescript
// Validation helpers
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable required`)
  return value
}

function requirePositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (!raw) return defaultValue
  const parsed = parseInt(raw, 10)
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`)
  }
  return parsed
}

// Usage
const ADMIN_TOKEN = requireEnv('ADMIN_TOKEN')
const DEFAULT_REWARD_SATS = requirePositiveInt('DEFAULT_REWARD_SATS', 330)
const TAP_COOLDOWN_MS = requirePositiveInt('TAP_COOLDOWN_MS', 60000)
const DAILY_SPEND_CAP_SATS = requirePositiveInt('DAILY_SPEND_CAP_SATS', 100000)
const IP_RATE_LIMIT_MAX = requirePositiveInt('IP_RATE_LIMIT_MAX', 10)
```

**Affected files:**
- `server/src/main.ts` — add validation logic

## Acceptance Criteria

- [ ] Server refuses to start if `ADMIN_TOKEN` missing or empty
- [ ] Server refuses to start if numeric configs are invalid (NaN, negative, zero where inappropriate)
- [ ] Clear error messages indicate which config is wrong
- [ ] Startup logs show loaded config values (secrets redacted)
- [ ] Tests verify validation catches common mistakes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-06 | Created from code review | Fail-fast principle prevents runtime surprises |

## Resources

- Config parsing: `server/src/main.ts:56-63`

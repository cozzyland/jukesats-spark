---
status: pending
priority: p3
issue_id: "012"
tags: [infrastructure, code-review, server]
dependencies: []
---

# No Structured Logging

## Problem Statement

All logging uses `console.log()` with no log levels, structured metadata, or JSON output. Hard to filter, parse, or set up alerting.

## Findings

- **Location:** Throughout `server/src/main.ts` and `hotWallet.ts`
- **Current:** Plain console methods
- **Missing:** Log levels, JSON format, request IDs

## Recommended Action

Add simple JSON logger or use pino/winston.

```typescript
export const logger = {
  info: (msg: string, data?: object) =>
    console.log(JSON.stringify({ level: 'info', ts: Date.now(), msg, ...data })),
  error: (msg: string, error?: Error, data?: object) =>
    console.error(JSON.stringify({ level: 'error', ts: Date.now(), msg, error: error?.message, ...data })),
}
```

## Acceptance Criteria

- [ ] All logs are JSON-formatted
- [ ] Logs include timestamp, level, message
- [ ] Request IDs included where relevant

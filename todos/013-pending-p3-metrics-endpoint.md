---
status: pending
priority: p3
issue_id: "013"
tags: [infrastructure, code-review, server, monitoring]
dependencies: []
---

# No Metrics/Monitoring Endpoint

## Problem Statement

No `/metrics` endpoint for monitoring tools. Cannot track taps/hour, success rate, response times, or wallet balance programmatically.

## Findings

- **Location:** `server/src/main.ts`
- **Missing:** Prometheus-format metrics endpoint

## Recommended Action

Add metrics endpoint returning Prometheus format:

```typescript
app.get('/metrics', async (req, res) => {
  const todaySpend = tapTracker.getTodaySpend()
  const balance = await hotWallet.getBalanceStatus()

  res.type('text/plain').send(`
# HELP jukesats_today_spend_sats Sats spent today
# TYPE jukesats_today_spend_sats gauge
jukesats_today_spend_sats ${todaySpend}

# HELP jukesats_wallet_balance_sats Hot wallet balance
# TYPE jukesats_wallet_balance_sats gauge
jukesats_wallet_balance_sats ${balance.available}
  `)
})
```

## Acceptance Criteria

- [ ] GET /metrics returns Prometheus-format data
- [ ] Includes: tap counts, wallet balance, today spend

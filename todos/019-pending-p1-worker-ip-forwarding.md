---
status: pending
priority: p1
issue_id: "019"
tags: [security, cloudflare, code-review]
dependencies: []
---

# Cloudflare Worker Doesn't Forward Client IP

## Problem
The Cloudflare Worker proxy doesn't forward `CF-Connecting-IP` as `X-Forwarded-For` to the Fly.io server, so server-side IP rate limiting sees the Worker's IP instead of the real client IP.

## Fix Needed
Forward `CF-Connecting-IP` header as `X-Forwarded-For` in the Worker's fetch to the origin. The worker code is deployed directly to Cloudflare (not in this repo), so this fix must be applied via `wrangler`.

## Files to Change
- Cloudflare Worker `src/index.ts` (deployed separately)

---
title: "ARK Address Regex Max Length Too Short"
category: runtime-errors
tags: [ark, regex, validation, server, nfc-tap]
module: server
symptoms:
  - "Tap failed: 400" error on every NFC tap
  - No server-side log entries for the tap (400 returned before processTap)
  - Server returns "Invalid ARK address format"
date_solved: "2026-02-10"
---

# ARK Address Regex Max Length Too Short

## Symptom

Every NFC tap failed with "Tap failed: 400". The server returned `{ error: "Invalid ARK address format" }` but this wasn't visible to the user because the client only displayed the status code.

No server logs appeared because the 400 was returned at the route handler level, before `processTap()` was called — making it invisible in standard error logging.

## Investigation

1. Checked server logs — no tap requests logged at all
2. Tested tap endpoint directly with `curl` — discovered the 400 came from ARK address regex validation
3. Measured a real ARK testnet address: `tark1qqwfx8hrgr...` = 115 characters total, 110 after the `tark1` prefix
4. The regex `{20,100}` only allowed up to 100 characters after the prefix — real addresses are 110 characters

## Root Cause

The ARK address validation regex in `server/src/main.ts` and `src/QRSendScreen.tsx` was:

```javascript
/^(t?ark1)[a-z0-9]{20,100}$/
```

Real ARK addresses (both mainnet `ark1` and testnet `tark1`) use bech32 encoding and are approximately 115 characters total. The `{20,100}` range was too restrictive — it should be `{20,200}` to accommodate all valid address lengths.

## Solution

Updated the regex max length from 100 to 200 in both files:

```javascript
// server/src/main.ts
const ARK_ADDRESS_RE = /^(t?ark1)[a-z0-9]{20,200}$/

// src/QRSendScreen.tsx
return /^(t?ark1)[a-z0-9]{20,200}$/.test(s)
```

## Prevention

- When adding address format validation, test with REAL addresses from the target network, not shortened test strings
- ARK/Bitcoin bech32 addresses can be longer than expected — use a generous upper bound
- Log 400 responses server-side (or at minimum, include the actual error message in client-side error display) so validation failures are diagnosable
- Add integration tests that use real-length addresses

## Debugging Tip

When NFC taps fail with no server logs, the issue is likely in the route handler's pre-validation (before `processTap`). Check:
1. Missing required fields
2. Address regex validation
3. These return 400 directly without logging

## Related

- `server/src/main.ts` — ARK_ADDRESS_RE constant
- `src/QRSendScreen.tsx` — `looksLikeArkAddress()` function
- The client `submitTap()` in `App.tsx` discards the server error message for non-429 responses — shows only "Tap failed: {status}" which obscures the actual cause

---
title: "feat: Add P2P QR code zap (send/receive sats between wallets)"
type: feat
date: 2026-02-07
---

# feat: Add P2P QR code zap (send/receive sats between wallets)

## Overview

Add the ability for two Jukesats users to send sats to each other by scanning a QR code. Receiver displays a QR code with their ARK address + optional amount, sender scans it with their camera and confirms the payment.

## Why Not NFC?

True iPhone-to-iPhone NFC peer-to-peer is **not possible**. Apple does not expose P2P NFC (SNEP/LLCP) APIs. The new iOS 18.1 CardSession/HCE requires a commercial agreement with Apple, fees, and compliance requirements designed for banks — not feasible for an indie app. No Lightning wallet has ever shipped iPhone-to-iPhone NFC payments. QR codes are the industry standard (Wallet of Satoshi, Phoenix, Breez, Zeus all use this approach).

## Key Insight: P2P Already Works at Protocol Level

The existing `sendBitcoin()` in `src/wallet.ts` already sends sats directly from the user's wallet to any ARK address — no server involvement. The withdraw feature (`src/WithdrawOverlay.tsx`) proves this works. All we need is a way to exchange the recipient's address.

## Proposed Solution

### Receive Flow
1. User taps **"Receive"** button (already exists — currently shares address as text)
2. Instead of (or in addition to) the share sheet, show a **QR code** containing the user's ARK address
3. Optionally, user can set a **requested amount**
4. QR encodes: `ark:<address>?amount=<sats>` (or just the raw address for simplicity)

### Send Flow
1. User taps **"Send"** / **"Zap"** button
2. Camera opens to **scan QR code**
3. App parses the ARK address (and amount if present)
4. User sees confirmation screen: recipient address (truncated) + amount
5. User confirms → `sendBitcoin()` executes
6. Success/error feedback

## Technical Approach

### New Dependencies

```json
{
  "react-native-qrcode-svg": "^6.x",
  "expo-camera": "~16.x"
}
```

`react-native-qrcode-svg` renders QR codes as SVG. `expo-camera` provides the barcode scanner.

### Files to Modify

| File | Change |
|------|--------|
| `App.tsx` | Replace share sheet on "Receive" tap with QR display screen. Add "Send" button (visible always, not just when balance > 0). Route to send/scan flow. |
| `src/WithdrawOverlay.tsx` | Refactor to accept pre-filled address+amount from QR scan (currently only manual entry). |
| `src/QRReceiveScreen.tsx` | **New.** Displays QR code of user's ARK address. Optional amount input. |
| `src/QRSendScreen.tsx` | **New.** Camera view to scan QR code. Parses address, transitions to confirm screen. |
| `package.json` | Add `react-native-qrcode-svg`, `expo-camera` |

### QR Code Format

Keep it simple for v1:

```
# Just the address (no amount)
ark1qq4hfssprtcgnjzf8qlw2f78yvjau5kld...

# With amount (optional)
ark:ark1qq4hfssprtcgnjzf8qlw2f78yvjau5kld...?amount=330
```

Use the `ark:` URI scheme prefix when amount is specified, raw address when not. The scanner should handle both.

### UI Changes

**Home screen** — change button layout:

```
Current:                    New:
┌──────────┐               ┌────────┐  ┌────────┐
│ Receive  │               │  Send  │  │Receive │
└──────────┘               └────────┘  └────────┘
┌──────────┐
│ Withdraw │  (balance>0)
└──────────┘
```

- **Receive** → opens QR display screen (replaces share sheet)
- **Send** → opens camera scanner (replaces "Withdraw" button)
- "Send" consolidates the current Withdraw feature — scanning a QR is just a faster way to fill in the address

### Reuse Existing Code

- `sendBitcoin()` from `src/wallet.ts:25` — already works for P2P
- `getAddress()` from `src/wallet.ts:17` — get current user's address for QR
- `WithdrawOverlay` confirmation/sending/success UI — reuse the state machine, just pre-fill from QR scan
- `refreshBalance()` from `App.tsx:237` — update balance after send

## Acceptance Criteria

- [ ] Receive screen shows QR code with user's ARK address
- [ ] QR code is scannable by another Jukesats app (or any QR reader)
- [ ] Camera scanner opens and reads ARK address QR codes
- [ ] After scan, user sees confirmation with address + amount
- [ ] Send executes via existing `sendBitcoin()` — no new server endpoints
- [ ] Balance updates after successful send (both sender and receiver)
- [ ] Error handling for: insufficient balance, invalid address, camera permission denied
- [ ] Works on physical iPhone (TestFlight)

## What This Does NOT Include (Future)

- BLE proximity discovery ("nearby zap")
- NFC tap-to-zap (blocked by Apple, may revisit if iOS opens up)
- Contact list / address book
- Payment history screen
- Push notifications for incoming payments
- Amount request / invoice system

## References

- Existing send implementation: `src/wallet.ts:25`, `src/WithdrawOverlay.tsx:95`
- ARK SDK sendBitcoin: `wallet.sendBitcoin({ address, amount })`
- Brainstorm: `docs/brainstorms/2026-02-01-nfc-native-app-brainstorm.md`
- [react-native-qrcode-svg](https://github.com/nickyjs/react-native-qrcode-svg)
- [expo-camera barcode scanning](https://docs.expo.dev/versions/latest/sdk/camera/)

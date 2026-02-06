---
title: "feat: Withdraw / Send Bitcoin via ARK"
type: feat
date: 2026-02-06
---

# feat: Withdraw / Send Bitcoin via ARK

## Overview

Add a "Withdraw" button to the Jukesats app so users can send their earned sats to another ARK wallet address. The user's on-device wallet calls `wallet.sendBitcoin()` directly — no server involvement needed.

## Problem Statement

Users can earn sats by tapping NFC tags but have no way to withdraw them. The wallet is receive-only. Users need to move sats to their main ARK wallet or to friends.

## Proposed Solution

A withdraw overlay on the ready screen with: address input, amount input, confirmation step, and success/error display. Follows the existing single-screen overlay pattern (like `tapSuccess`).

### Reference: Arkade Wallet Send Flow

The official [arkade-os/wallet](https://github.com/arkade-os/wallet) uses a 3-screen wizard:
1. **Form** — address + amount input with auto-detection of recipient type
2. **Details** — confirmation screen ("Tap to Sign") showing fees and total
3. **Success** — txid display

We'll simplify this to a 2-step flow (form + confirm) since we only support ARK addresses.

## Technical Approach

### State Management

Use **local state within `ready`** (not a new `AppState` variant) to preserve deep link handling:

```typescript
// App.tsx — inside the ready/tapSuccess render branch
const [withdrawStep, setWithdrawStep] = useState<'hidden' | 'form' | 'confirm' | 'sending' | 'success' | 'error'>('hidden')
const [withdrawAddress, setWithdrawAddress] = useState('')
const [withdrawAmount, setWithdrawAmount] = useState('')
const [withdrawTxid, setWithdrawTxid] = useState('')
const [withdrawError, setWithdrawError] = useState('')
```

This keeps `state.kind === 'ready'` so `Linking.addEventListener` continues processing NFC taps. If a deep link arrives while the form is open, close the form and process the tap.

### Address Validation

Use `ArkAddress.decode()` from the SDK for full bech32m validation (not just prefix check):

```typescript
// App.tsx
import { ArkAddress } from '@arkade-os/sdk'

function validateArkAddress(input: string): string | null {
  const trimmed = input.trim()
  try {
    ArkAddress.decode(trimmed)
    return null // valid
  } catch {
    return 'Invalid ARK address'
  }
}
```

Also detect and strip BIP21 URIs via `BIP21.parse()` if the user pastes `bitcoin:...?ark=tark1...`.

Self-send detection: compare against `getAddress()` and reject with "Cannot send to yourself".

### Amount Validation

- Integer sats only (`parseInt`, reject decimals)
- Must be > 0
- Must be <= `balance.available`
- Dust guard: if `balance - amount` is between 1 and `wallet.dustAmount`, reject with explanation. Sending the entire balance (leaving 0) is allowed.

### Send Max

A "Max" button sets amount to the full available balance. This empties the wallet entirely. The SDK handles VTXO selection and change internally.

### Fee Handling

ARK off-chain transfers have near-zero protocol fees. The SDK's `sendBitcoin()` handles fees internally. For v1, we don't display fees separately — the amount the user enters is what gets sent. If the SDK fails due to insufficient funds to cover protocol fees, we show the error.

### Confirmation Step

Before calling `sendBitcoin()`, show a review screen:
```
Send 500 sats to
tark1q8f...3ye

[Cancel]  [Confirm Send]
```

This prevents accidental sends. The user must explicitly confirm.

### Send Flow

```typescript
async function handleWithdraw() {
  setWithdrawStep('sending')
  try {
    const wallet = getWallet()
    // Re-fetch balance to check staleness
    const bal = await wallet.getBalance()
    const available = Number(bal.available)
    if (available < amount) {
      throw new Error(`Insufficient balance: ${available} sats available`)
    }
    const txid = await wallet.sendBitcoin({
      address: withdrawAddress.trim(),
      amount: parseInt(withdrawAmount, 10)
    })
    setWithdrawTxid(txid)
    setWithdrawStep('success')
    // Refresh balance in main state
    const newBal = await wallet.getBalance()
    setState({ kind: 'ready', balance: Number(newBal.available), address: state.address })
  } catch (error) {
    setWithdrawError(error instanceof Error ? error.message : 'Send failed')
    setWithdrawStep('error')
  }
}
```

### Concurrent Send Prevention

Disable the Send/Confirm button while `withdrawStep === 'sending'`. The `sendBitcoin` call involves interactive ARK batch signing that can take several seconds.

### Deep Link During Withdraw

If a deep link (NFC tap) arrives while the withdraw form is open:
- Close the withdraw form (`setWithdrawStep('hidden')`)
- Process the tap normally
- User can re-open withdraw afterward

### Keyboard Handling

Wrap the form in `KeyboardAvoidingView` with `behavior="padding"` (iOS). The current `justifyContent: 'center'` layout will push the form behind the keyboard on smaller phones without this.

## UI Design

Follow existing design language:
- Dark background `#0a0a0a`
- Bitcoin orange `#f7931a` for primary actions
- White `#fff` for text
- Muted `#888` for labels
- Error red `#ff4444`
- `Pressable` buttons with `borderRadius: 8`

### Screens

**1. Ready screen (modified)**
```
         Jukesats

          BALANCE
        1,320 sats

   tark1q8f...3yefnk

 Tap an NFC tag to earn sats

      [ Withdraw ]          <-- NEW button, below hint text
```

**2. Withdraw form overlay**
```
         Withdraw

    Recipient ARK address
    [________________________]
              [Paste]

    Amount (sats)
    [____________] [Max]

    [Cancel]  [Continue]
```

**3. Confirmation overlay**
```
        Confirm Send

      500 sats

           to

    tark1q8f...3yefnk

    [Cancel]  [Send]
```

**4. Sending state**
```
      Sending...
    (ActivityIndicator)
```

**5. Success overlay**
```
        Sent!

      500 sats

   TX: a1b2c3...f4e5
        [Copy]

        [Done]
```

**6. Error overlay**
```
      Send Failed

   Insufficient balance

   [Retry]  [Cancel]
```

## Acceptance Criteria

- [ ] "Withdraw" button visible on ready screen
- [ ] Address input validates with `ArkAddress.decode()` — rejects invalid addresses
- [ ] Self-send detection — rejects user's own address
- [ ] Amount input: integer sats only, > 0, <= available balance
- [ ] Dust guard: rejects amounts that would leave 1-999 sats change
- [ ] "Max" button populates full available balance
- [ ] Confirmation screen shown before sending
- [ ] `wallet.sendBitcoin()` called with correct params
- [ ] Success screen shows txid
- [ ] Balance refreshed after successful send
- [ ] Error screen shown on failure with retry option
- [ ] Button disabled while sending (prevent double-send)
- [ ] Deep links still work while form is open (form closes, tap processes)
- [ ] Keyboard doesn't obscure inputs on small screens
- [ ] BIP21 URI support: `bitcoin:...?ark=tark1...` is parsed correctly

## Files to Modify

| File | Changes |
|------|---------|
| `App.tsx` | Add withdraw state, form overlay, confirm overlay, success/error overlays, handleWithdraw function |
| `package.json` | Add `expo-clipboard` for copy txid functionality |

No server changes needed — the on-device wallet sends directly via the ARK protocol.

## Dependencies

- `expo-clipboard` — for "Copy txid" and "Paste address" buttons (new dependency)
- `ArkAddress` from `@arkade-os/sdk` — already installed, used for address validation
- `BIP21` from `@arkade-os/sdk` — already installed, used for URI parsing

## Risks

| Risk | Mitigation |
|------|-----------|
| `sendBitcoin` takes >5s (batch signing) | Show ActivityIndicator, disable button |
| VTXO swept during send attempt | SDK handles internally; show error if fails |
| ARK server down | sendBitcoin will throw; show "Server unreachable" error |
| User pastes on-chain address (tb1/bc1) | Reject with "Only ARK addresses supported". Add on-chain support in v2 |
| Fees cause send to fail when balance is exact | Re-fetch balance pre-send; show SDK error message |

## Not In Scope (v2)

- QR code scanner for addresses
- On-chain Bitcoin address support (tb1/bc1)
- Lightning invoice support
- Biometric auth before sending (needed for mainnet)
- Transaction history screen
- Fiat amount display
- Address book / recent recipients

## References

- ARK SDK `sendBitcoin`: `node_modules/@arkade-os/sdk/dist/types/wallet/wallet.d.ts`
- ARK SDK `ArkAddress.decode`: `node_modules/@arkade-os/sdk/dist/types/script/address.d.ts`
- ARK SDK `BIP21`: `node_modules/@arkade-os/sdk/dist/types/utils/bip21.d.ts`
- Arkade reference wallet send flow: [github.com/arkade-os/wallet/src/screens/Wallet/Send/](https://github.com/arkade-os/wallet/tree/master/src/screens/Wallet/Send)
- Server-side sendBitcoin pattern: `server/src/hotWallet.ts:254-305`
- Existing wallet module: `src/wallet.ts`
- NFC brainstorm: `docs/brainstorms/2026-02-01-nfc-native-app-brainstorm.md`

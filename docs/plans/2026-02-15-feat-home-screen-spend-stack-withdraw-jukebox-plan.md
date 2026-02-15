---
title: "feat: Home Screen Redesign — Spend, Stack, Withdraw, Jukebox"
type: feat
date: 2026-02-15
---

# Home Screen Redesign — Spend, Stack, Withdraw, Jukebox

## Overview

Redesign the home screen around four clear actions a user can take with their sats:

1. **Buy Coffee** — spend real Bitcoin on a coffee at the venue
2. **Stack Sats** — keep saving, with education on why Bitcoin > fiat for savings
3. **Withdraw** — move sats to Bitcoin on-chain, Lightning, or another ARK wallet
4. **Jukebox** — spend sats on the venue's music selection player

Each section has an educational tooltip (?) explaining the Bitcoin significance of the action. The coffee purchase flow uses balance thresholds — when you have enough sats for a coffee, the UI tells you.

## Context & Prior Research

This builds on the deep UX research from `docs/plans/2026-02-13-feat-stamp-card-wallet-balance-ux-clarity-plan.md`, which established:
- Stamps track visits (permanent), balance tracks sats (volatile)
- No Bitcoin app uses punch cards — Jukesats is first-mover
- Balance-threshold milestones ("you can afford a coffee!") are the strongest pattern for liquid rewards
- "Giving people the freedom to leave makes them stay" — Bitcoin loyalty paradox
- 3,300 sats ≈ $2.27 at ~$69K BTC (Feb 2026); works for basic coffee or appreciates over time

## Current State

The home screen (just shipped in build 4) shows:
1. Header (Jukesats + NFC icon)
2. Coffee Card (10-stamp visit tracker, "X/10 visits")
3. Total Earned line ("Earned: X sats from Y taps")
4. Balance ("Your Sats" — hero number, 48px)
5. Action Row (Send / Receive buttons)

**Existing code that can be reused:**
- `src/QRSendScreen.tsx` — QR scanner already parses ARK URIs with amounts. Cafe displays `ark:tark1<address>?amount=3300`, scanner picks up address + amount.
- `src/WithdrawOverlay.tsx` — already skips to confirm step when both address AND amount are pre-filled (line 57-61). "Buy coffee" = scan cafe QR → confirm → send.
- `src/wallet.ts` — `sendBitcoin()` works for any ARK address. No server involvement needed for payments.
- `wallet.getTransactionHistory()` — SDK method exists but is not exposed in UI yet.

**What the wallet SDK supports:**
- ARK sends (implemented, working)
- Offboard to on-chain BTC via `Ramps.offboard(destinationAddress)` (not yet exposed in UI)
- `settle()` — move VTXOs on-chain (not yet exposed)
- **No Lightning support in SDK** — would need a bridge or separate integration

## Proposed Home Screen Layout

```
┌──────────────────────────────────┐
│       Jukesats          📡       │  Header
│                                  │
│  ┌────────────────────────────┐  │
│  │      COFFEE CARD           │  │
│  │  ⭐⭐⭐⭐⭐                │  │  Visit tracker
│  │  ⭐⭐○○○                   │  │  (permanent, never decreases)
│  │      7/10 visits           │  │
│  └────────────────────────────┘  │
│                                  │
│  Earned: 2,310 sats from 7 taps │  Total earned (permanent)
│                                  │
│          YOUR SATS               │
│          4,200                   │  Hero balance
│     spend, send, or stack        │
│                                  │
│  ☕ You have enough for a coffee! │  Coffee threshold indicator
│  [ Buy Coffee ]                  │  (only when balance >= COFFEE_PRICE)
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │  📤  │ │  💰  │ │  🎵  │    │
│  │ Send │ │ Stack│ │Juke- │    │
│  │      │ │  (?) │ │box(?)│    │
│  └──────┘ └──────┘ └──────┘    │
│                                  │
│  [ Receive ]                     │  Receive stays accessible
└──────────────────────────────────┘
```

### Key Design Decisions

**Coffee indicator**: When `balance >= COFFEE_PRICE_SATS`, a coffee icon + "You have enough for a coffee!" appears above the action buttons. Tapping "Buy Coffee" opens the QR scanner (same as current Send flow) to scan the cafe's payment terminal. When `balance < COFFEE_PRICE_SATS`, the coffee indicator is hidden — no "progress bar" that goes backwards.

**Action grid**: Replace the current Send/Receive row with a 3-button grid:
- **Send** — opens QR scanner (existing flow, for sending to any ARK address)
- **Stack (?)** — tooltip/educational overlay about saving in Bitcoin
- **Jukebox (?)** — tooltip explaining the jukebox concept (mock, no backend yet)

**Receive** stays as a standalone button below the grid (or at the bottom).

## Feature Breakdown

### 1. Coffee Purchase Indicator & Flow

**What it does:**
- Constant `COFFEE_PRICE_SATS = 3300` (configurable, could be fetched from server later)
- When `balance >= COFFEE_PRICE_SATS`: show coffee icon + text + "Buy Coffee" button
- When `balance < COFFEE_PRICE_SATS`: hide the coffee section entirely (no empty cup, no "X more sats needed" — avoids backwards progress psychology)
- "Buy Coffee" button opens `QRSendScreen` → user scans cafe's ARK QR → `WithdrawOverlay` confirms → send
- After sending, balance drops below threshold, coffee indicator disappears naturally

**Tooltip (?):** "You're about to spend real Bitcoin on a coffee. Not loyalty points — actual money on the Bitcoin network. Your cafe accepts Bitcoin."

**Files to modify:**
- `App.tsx` — add coffee indicator section, `COFFEE_PRICE_SATS` constant, conditional rendering
- `src/QRSendScreen.tsx` — minor: update hint text to "Scan cafe payment QR" when initiated from "Buy Coffee"

**Why this works:** The coffee indicator is a balance-threshold milestone. It appears when true ("you can buy a coffee"), disappears when false ("you spent it or withdrew"). It never lies. No progress bar to go backwards.

### 2. Stack Sats — Educational Tooltip

**What it does:**
- "Stack" button with (?) icon in the action grid
- Tapping opens an educational overlay explaining why saving in Bitcoin is better than saving in fiat
- Content covers:
  - **Fiat depreciation**: Your dollars/euros buy less coffee every year (inflation)
  - **Extreme example**: Argentine peso — 100 ARS bought a coffee in 2020, needs 2,500+ ARS in 2026
  - **Moderate example**: USD/EUR — $5 coffee in 2020, $7 coffee in 2026 (40% inflation)
  - **Bitcoin thesis**: Saving in sats means your savings can buy MORE coffee over time, not less
  - **Simple visual**: "100 sats today → ??? coffees tomorrow" (appreciation angle)
- Dismissable overlay, can be viewed any time (not one-time)

**Tooltip (?):** Tapping (?) on the Stack button opens this educational content.

**Files to create:**
- `src/EducationalOverlay.tsx` — reusable overlay component for educational content
- Content for "Stack" education (inline in component or separate data)

**Files to modify:**
- `App.tsx` — add Stack button to action grid, overlay state for education

### 3. Withdraw — Send to External Wallets

**What it does:**
- "Send" button in the action grid — same as current Send flow
- Opens QR scanner → WithdrawOverlay → send to any ARK address
- **Future**: Add support for Lightning invoices and on-chain BTC addresses

**Tooltip (?):** "Send your sats to any Bitcoin wallet. ARK, Lightning, or on-chain — your Bitcoin, your choice."

**Current state (ARK only):**
- Already fully functional via QRSendScreen + WithdrawOverlay
- Only validates ARK addresses (`tark1...` / `ark1...`)

**Future (Lightning + On-chain) — separate plan:**
- Lightning: Would need a Lightning bridge/gateway (not in ARK SDK)
- On-chain: SDK has `Ramps.offboard(destinationAddress)` — needs UI wrapper
- Address detection: parse `lnbc...` (Lightning invoice), `bc1...` (on-chain), `ark1...` (ARK) and route accordingly

**Files to modify (current phase):**
- `App.tsx` — move Send to action grid, add tooltip
- No changes to send flow itself

### 4. Jukebox — Spend Sats on Music (Mock)

**What it does:**
- "Jukebox" button with (?) icon in action grid
- Tapping (?) opens educational overlay explaining the concept
- Tapping the button itself shows "Coming soon!" or a preview of the jukebox concept
- **No backend, no payment flow** — purely informational mock

**Tooltip (?):** "Jukesats isn't just a wallet — it's a jukebox! Spend real Bitcoin to pick songs on the music player at your table. Coming soon."

**Future vision:**
- Jukebox device at cafe tables with an ARK address
- User scans jukebox QR → pays X sats → selects a song
- Song plays on venue speakers
- Potentially: bidding/tipping for song priority

**Files to create:**
- Content for jukebox tooltip in `EducationalOverlay.tsx`

**Files to modify:**
- `App.tsx` — add Jukebox button to action grid, "coming soon" state

### 5. Educational Tooltips System

**What it does:**
- Each action button has a small (?) icon
- Tapping (?) opens a modal/overlay with educational content specific to that action
- Content is rich text with examples, not just a one-liner
- Overlays are dismissable and re-viewable (not one-time)

**Tooltip content summary:**

| Section | Key Message |
|---|---|
| **Buy Coffee** | "You're spending real Bitcoin, not loyalty points. Your cafe accepts BTC." |
| **Stack** | "Saving in Bitcoin means more coffee later. Saving in fiat means less." + inflation examples |
| **Send** | "Send sats anywhere — ARK, Lightning, on-chain. Your Bitcoin, your choice." |
| **Jukebox** | "Spend Bitcoin on music at your table. Coming soon." |

**Files to create:**
- `src/EducationalOverlay.tsx` — modal component that accepts title + content
- Could use a simple `{ title: string; content: string[] }` data structure per tooltip

## Acceptance Criteria

### Phase 1: Coffee Indicator + Action Grid (Ship Now)
- [x] `COFFEE_PRICE_SATS` constant defined (3300)
- [x] Coffee icon + "You have enough for a coffee!" appears when balance >= threshold
- [x] "Buy Coffee" button opens QR scanner (reuses existing send flow)
- [x] Coffee indicator hidden when balance < threshold (no backwards progress)
- [x] Action grid replaces Send/Receive row: Send, Stack, Jukebox
- [x] Receive button relocated below the grid
- [x] Stack button opens educational overlay about saving in Bitcoin
- [x] Jukebox button shows "coming soon" or concept preview
- [x] Each button has (?) tooltip icon
- [x] Coffee Card (visit tracker) remains above the balance

### Phase 2: Educational Content (Ship With or Shortly After)
- [x] EducationalOverlay component built (reusable modal)
- [x] Buy Coffee tooltip content written
- [x] Stack tooltip content with fiat vs Bitcoin examples (Argentina, USD/EUR)
- [x] Send tooltip content about Bitcoin network options
- [x] Jukebox tooltip content about the concept
- [ ] One-time educational note on first-ever withdrawal (from prior plan)

### Phase 3: Enhanced Visuals (Future)
- [ ] Coffee cup filling animation (replaces simple icon)
- [ ] Transaction history view
- [ ] Achievement badges for milestones

### Phase 4: Extended Wallet Support (Future)
- [ ] Lightning Network sends (requires bridge/gateway)
- [ ] On-chain BTC sends (via SDK `Ramps.offboard()`)
- [ ] Address type detection (ARK / Lightning / on-chain)
- [ ] Jukebox backend integration (when hardware is ready)

## Technical Considerations

### Files to Modify
- `App.tsx` — main layout restructure: coffee indicator, action grid, tooltip state management
- `src/QRSendScreen.tsx` — optional hint text update for "Buy Coffee" context

### Files to Create
- `src/EducationalOverlay.tsx` — reusable modal for tooltips/education
- `src/CoffeeIndicator.tsx` — coffee threshold indicator component

### No Server Changes Needed
All spending happens client-side via wallet SDK `sendBitcoin()`. The cafe's payment terminal displays an ARK QR code — no Jukesats server involvement.

### Data Already Available
- `balance` (from local ARK wallet) — drives coffee threshold
- `tapCount` (from server `totalTaps`) — drives stamp card
- `REWARD_SATS = 330` (constant) — for total earned calculation
- `COFFEE_PRICE_SATS = 3300` (new constant) — for coffee threshold

### Key Gotchas (from docs/solutions/)
- Always filter by `status = 'completed'` when showing user stats (failed/pending taps exist)
- ARK addresses are 110+ chars — ensure UI handles long addresses gracefully
- Show actual validation errors to users on failed sends (don't silently swallow)

## Visual Layout Options for Action Grid

### Option A: Icon Grid (3 columns)
```
┌────────┐ ┌────────┐ ┌────────┐
│   📤   │ │   💰   │ │   🎵   │
│  Send  │ │  Stack │ │Jukebox │
│   (?)  │ │   (?)  │ │   (?)  │
└────────┘ └────────┘ └────────┘
```

### Option B: List with descriptions
```
┌──────────────────────────────────┐
│ 📤  Send Bitcoin          (?)    │
│ 💰  Stack & Save          (?)    │
│ 🎵  Jukebox               (?)    │
└──────────────────────────────────┘
```

### Option C: Cards with mini-descriptions
```
┌────────────────┐ ┌────────────────┐
│ 📤 Send        │ │ 💰 Stack       │
│ To any wallet  │ │ Save for later │
└────────────────┘ └────────────────┘
       ┌────────────────┐
       │ 🎵 Jukebox     │
       │ Play music     │
       └────────────────┘
```

## The Educational Story (Tooltip Content Draft)

### Buy Coffee Tooltip
> **You're spending real Bitcoin.**
>
> This isn't a loyalty card trick — when you buy a coffee, you're sending actual Bitcoin (sats) from your wallet to the cafe's wallet.
>
> The same technology that moves millions across borders is buying your flat white. That's Bitcoin.

### Stack Tooltip
> **Why saving in Bitcoin beats saving in dollars.**
>
> **Argentina (extreme):** A coffee cost 100 pesos in 2020. The same coffee costs 2,500+ pesos in 2026. Your pesos bought 25x less coffee in 6 years.
>
> **US/Europe (moderate):** A $5 coffee in 2020 costs ~$7 in 2026. Your dollars buy ~30% less coffee.
>
> **Bitcoin:** 10,000 sats bought a coffee in 2020. Those same 10,000 sats could buy 3+ coffees today. Your sats bought MORE coffee over time.
>
> Every sat you stack today could buy more tomorrow. That's the Bitcoin savings thesis.

### Send Tooltip
> **Your sats. Your choice.**
>
> Send to a friend's ARK wallet, move to your own hardware wallet, or pay for anything that accepts Bitcoin.
>
> Unlike loyalty points locked to one app, your sats work everywhere on the Bitcoin network.
>
> *Coming soon: Lightning Network and on-chain Bitcoin sends.*

### Jukebox Tooltip
> **The Jukesats Jukebox.**
>
> Spend real Bitcoin to pick songs on the music player at your table. Skip the queue, play your favorite track, tip the playlist.
>
> Your sats aren't just money — they're your voice in the room.
>
> *Coming soon.*

## References

### Code References
- Coffee Card: `src/StampCard.tsx` (just updated — "COFFEE CARD", "X/10 visits")
- Balance display: `App.tsx:337-351`
- QR scanner: `src/QRSendScreen.tsx` (parses `ark:<address>?amount=X`)
- Send flow: `src/WithdrawOverlay.tsx` (skips to confirm when address+amount pre-filled)
- Wallet SDK: `src/wallet.ts` (sendBitcoin, getBalance, getAddress)
- SDK types: `node_modules/@arkade-os/sdk/dist/types/wallet/wallet.d.ts`

### Prior Research
- UX plan: `docs/plans/2026-02-13-feat-stamp-card-wallet-balance-ux-clarity-plan.md`
- Balance-threshold milestones: strongest pattern for liquid rewards (Starbucks, RPG shops, YNAB)
- Bitcoin loyalty paradox: freedom to leave → increased loyalty
- Psychology: progress bars that go backwards are dangerous (Kahneman, Nunes & Dreze)
- Coffee economics: 3,300 sats ≈ $2.27 at ~$69K BTC; appreciates with Bitcoin price

### Solution Docs (Gotchas)
- `docs/solutions/logic-errors/getUserStats-counting-failed-taps.md` — filter by completed status
- `docs/solutions/runtime-errors/ark-address-regex-too-short.md` — addresses are 110+ chars

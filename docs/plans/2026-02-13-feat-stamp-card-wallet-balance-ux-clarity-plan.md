---
title: "feat: Stamp Card + Wallet Balance UX Clarity"
type: feat
date: 2026-02-13
---

# Stamp Card + Wallet Balance UX Clarity

## Overview

The app currently shows a **stamp card** (tap count) and **wallet balance** (spendable sats) side by side with no explanation of their relationship. When a user withdraws sats, the balance drops below what the stamp card implies they've earned — creating confusion instead of communicating the core value proposition: **these are real Bitcoin you own, not locked loyalty points.**

## Problem Statement

**Current state:** A user taps 5 times (5 stamps filled, 1,650 sats earned). They withdraw 1,000 sats to another ARK wallet. The screen shows 5/10 stamps but only 650 sats balance. The user thinks something is wrong.

**The worst case:** User taps 7 times (7/10 stamps). Withdraws ALL sats. Screen shows 7/10 stamps + 0 sats. The stamp card says "3 more taps to a coffee" but the user can't buy anything — those sats are gone. The card is lying.

**Desired state:** The user understands immediately:
1. The stamp card tracks **visits** — a permanent record of engagement that never goes backwards
2. The balance is **their wallet** — real Bitcoin they own and can do whatever they want with
3. The gap between "earned" and "held" is a *feature* (open, permissionless money), not a bug

## Deep Research Findings

### No Bitcoin App Uses Punch Cards

Extensive research across the Bitcoin rewards ecosystem found **zero apps using stamp/punch card metaphors**:

| App | Gamification Mechanic | Punch Card? |
|---|---|---|
| **Fold** | Spin wheel + cashback tiers | No |
| **Shakepay** | Shake-for-sats streak (21→1000 sats/day) | No |
| **Lolli** | Simple cashback percentage | No |
| **Satsback** | Zero gamification, utility-only | No |
| **sMiles** | Step counter + streak + competitions | No |
| **THNDR** | Lottery tickets from gameplay | No |
| **ZBD** | In-game reward overlays | No |
| **Stacker News** | Cowboy hat streak + Cowboy Credits | No |

**Why?** The punch card metaphor implies "progress you can't lose" — but Bitcoin rewards are liquid and withdrawable. The metaphor breaks. This is both a design risk and a first-mover opportunity for Jukesats.

### Psychology of Backward Progress

Research strongly warns against progress indicators that can decrease:

- **Loss aversion** (Kahneman & Tversky, 1979): Losses are psychologically weighted ~2x more than equivalent gains. A progress bar going from 70% to 50% hurts more than the pleasure of reaching 70% in the first place.
- **Endowed progress reversal** (Nunes & Dreze, 2006): Giving users a head start increases completion rates by 78%. Taking that progress away feels like theft — not "normal fluctuation."
- **Goal gradient destruction** (Kivetz et al., 2006): Users accelerate effort near goals (8/10 stamps → highly motivated). Reversing to 6/10 destroys the strongest motivational phase.
- **The "what-the-hell" effect** (Cochran & Tesser, 1996): When progress is lost, users often abandon entirely ("already ruined, why bother"). Risk of negative feedback loop — withdraw more → progress drops more → give up.
- **Status demotion research** (Dreze & Nunes, 2011): 25-30% spending reduction after loyalty status loss. ~20% disengage entirely.

**Bottom line:** A progress bar/stamp card tied to balance that can go backwards is psychologically dangerous. It will demotivate users, not engage them.

### The Gaming Solution: Dual-Track Systems

Games solved this decades ago by separating **permanent progress** from **volatile resources**:

- **Dark Souls**: XP/levels (permanent, never lost) vs. souls (volatile, dropped on death). Players don't rage-quit over lost souls because their levels are safe.
- **World of Warcraft**: Character level + achievements (permanent) vs. gold (spendable). Nobody has anxiety about gold fluctuating.
- **Pokemon Go**: Trainer level (permanent) vs. Stardust (spendable). Different screens, different visual treatments.
- **Roguelikes** (Hades, Dead Cells): Meta-progression permanent; run-specific resources reset. Full resets are psychologically easier than partial reversals.

**The pattern**: Permanent progress is shown as visual indicators (badges, levels, stamps). Volatile resources are shown as numbers. Users instinctively understand these are different things.

### The Fintech Pattern: Actionable Number as Hero

Every successful fintech app makes the **spendable/actionable** number the hero:

| App | Hero Number (Big) | Secondary (Smaller/Visual) |
|---|---|---|
| Robinhood | Portfolio value (spendable) | Daily return |
| Coinbase | Total balance (tradeable) | Earn opportunities |
| Cash App | Available balance (sendable) | Savings goals |
| Starbucks | Star balance (redeemable) | Tier progress bar |
| Delta | Redeemable miles (bookable) | Medallion status circles |

**Critical insight**: A **number** that goes from 700 to 500 feels like normal financial activity. A **progress bar** that visibly shrinks from 70% to 50% feels like failure. Same information, completely different emotional response.

### The Bitcoin Loyalty Paradox

Traditional loyalty programs create value through lock-in (your Starbucks stars are worthless elsewhere). Bitcoin's ethos is the opposite: self-custody, portability, no counterparty risk.

**The counterintuitive finding:** Giving people the freedom to leave makes them stay. When rewards are real Bitcoin that could be withdrawn at any moment, trust in the business increases. Trapped customers resent; respected customers return.

Examples:
- **Satoshi Coffee Co.** offers up to 21% back in withdrawable sats — the generous rate IS the loyalty mechanic
- **Fold** uses gamification (spin wheels, streaks) for psychological stickiness without technical lock-in — went public on Nasdaq
- **Lolli** partnered with Spark for instant Lightning withdrawals — "we earn your loyalty by letting you leave anytime"

### Coffee Economics in Sats (February 2026)

At ~$69K BTC:
- 3,300 sats ≈ **$2.27** — not a full $5 specialty coffee, but works for basic drip or emerging markets
- At $100K BTC → $3.30
- At $150K BTC → $4.95 (a real coffee)
- **The appreciation angle is the educational hook**: "The sats you earn today might buy two coffees next year"

Venue-side economics: **$2.27 per loyal customer (10 visits) vs. $20 industry-average customer acquisition cost.** That's 9x cheaper with guaranteed repeat visits.

## Proposed Solution

### Core Principle: Stamps Track Visits, Balance Tracks Sats

The stamp card becomes a **permanent record of engagement** — a soulbound achievement. You tapped 7 times at the venue. That happened. It cannot un-happen. Withdrawing sats doesn't un-visit.

The balance is a **financial number** — your Bitcoin wallet. It goes up and down like any bank balance. That's normal. That's freedom.

### A. Stamp Card = Visit Counter (Permanent, Never Decreases)

**What changes:**
- "TAP CARD" label → reframe to communicate visits/loyalty (e.g., "LOYALTY CARD" or "COFFEE CARD")
- "X/10" → "X/10 visits" or "X/10 ☕" — frames as visits, not sats-held
- Stamps reflect `totalTaps % 10` (already works this way — taps never decrease)
- 10/10 state: celebratory moment — "Coffee milestone!" or confetti animation
- Card wraps to 0/10 and cycle continues

**Why this works:** The stamps are always telling the truth. Even at 0 sats balance, "7/10 visits" is a fact. No cognitive dissonance.

### B. Balance = Your Sats (Hero Number, Volatile, Normal)

**What changes:**
- "BALANCE" → "YOUR SATS" or "YOUR BITCOIN"
- Optional subtitle: "Spend, send, or stack" (communicates freedom)
- Keep the 48px hero treatment — this is the actionable number
- Tapping refreshes from wallet (already implemented)

**Why this works:** Framing it as "your sats" communicates ownership. Users expect a wallet number to fluctuate — that's what money does.

### C. Total Earned Line (Bridges the Gap)

**Between stamp card and balance, a single secondary line:**
- "Earned: X,XXX sats from Y taps" (14px, gray, non-prominent)
- This number only goes up — monotonically increasing
- If earned > balance, the user can reason: "I sent some elsewhere — my sats, my choice"
- Computed client-side: `totalTaps × REWARD_SATS` — no new API needed

**Why this works:** Provides the audit trail without adding a competing hero number. Uses the Bitrefill/Fold pattern of separating "Total Earned" (permanent) from "Current Balance" (volatile).

### D. Educational Note on First Withdrawal

**When a user first sends sats, show a one-time dismissable note:**
> "Your sats are real Bitcoin. Unlike loyalty points, you can send them anywhere — to a friend, another wallet, or spend them on coffee. The choice is yours."

- Persist via AsyncStorage
- Show once, never again
- Intercepts the exact moment confusion would arise

### E. (Future) Achievements & Milestones

Replace the wrapping stamp card cycle with permanent achievement milestones:
- "First Tap" badge
- "10-Tap Regular" badge
- "50 Taps" milestone celebration
- "First Coffee Earned" (lifetime earned crosses 3,300 sats)
- Streak tracking (consecutive days visiting)

These are **soulbound** — permanent records of what you did. Separate from what you hold.

### F. (Future) Transaction History

A tappable detail view showing:
- Each tap reward (+330 sats, timestamp, venue)
- Each send/withdrawal (amount, destination)
- Running balance over time

## Visual Layout (Proposed)

```
┌─────────────────────────────────┐
│      Jukesats          📡      │  Header
│                                 │
│  ┌─────────────────────────┐   │
│  │     COFFEE CARD          │   │
│  │  ⭐⭐⭐⭐⭐              │   │  Stamps = visits
│  │  ⭐⭐○○○                 │   │  (permanent, never decrease)
│  │     7/10 visits          │   │
│  └─────────────────────────┘   │
│                                 │
│  Earned: 2,310 sats from 7 taps│  Total earned (permanent, gray)
│                                 │
│         YOUR SATS               │  Balance label
│         1,310                   │  Hero number (48px, volatile)
│    spend, send, or stack        │  Subtitle (ownership)
│                                 │
│    [ Send ]    [ Receive ]      │  Action row
└─────────────────────────────────┘
```

**Key visual hierarchy:**
1. Stamp card (visual, engagement, always true)
2. Total earned (small text, permanent, bridges the gap)
3. Balance (hero number, actionable, volatile)
4. Actions (spend the balance)

## Acceptance Criteria

### Phase 1: Reframing (Minimal Code Changes)
- [x] Stamp card label reframed to communicate visits/loyalty, not sats
- [x] "X/10" counter reframed as visits (e.g., "7/10 visits")
- [x] Balance label changed to communicate ownership ("YOUR SATS")
- [x] "Total earned" line added between stamp card and balance
- [x] 10/10 stamp state shows coffee milestone celebration
- [x] No new API endpoints — uses existing `totalTaps` from server

### Phase 2: Educational Touch
- [ ] One-time educational note on first withdrawal
- [ ] Persisted via AsyncStorage
- [ ] Dismissable with tap/button

### Phase 3: Achievements (Future)
- [ ] Permanent achievement badges for tap milestones
- [ ] Streak tracking for consecutive visits
- [ ] Transaction history view

## Technical Considerations

### Files to Modify (Phase 1)
- `src/StampCard.tsx` — update labels ("COFFEE CARD", "X/10 visits"), 10/10 celebration state
- `App.tsx` — update balance label ("YOUR SATS"), add "Total earned" line, add subtitle

### Files to Modify (Phase 2)
- `App.tsx` — one-time educational modal on first send
- New: `src/EducationalNote.tsx` — simple dismissable component

### Data Already Available (No Server Changes)
- `tapCount` (from `totalTaps` server response) → drives stamps AND total earned
- `balance` (from local ARK wallet) → drives balance display
- `REWARD_SATS = 330` (constant) → total earned = `tapCount × 330`
- `GET /user-stats/:address` already returns `totalTaps`

## The Bigger Picture

| Traditional Loyalty App | Jukesats |
|---|---|
| Earn points locked to one brand | Earn real Bitcoin |
| Can only redeem within ecosystem | Send anywhere, to anyone |
| Points expire | Sats are yours forever |
| Company controls your balance | You hold your own keys |
| Progress can't go backwards | You can withdraw anytime — that's the point |

**The stamp card says:** "Come back, earn coffee, it's fun and familiar."
**The wallet says:** "By the way, you now own Bitcoin, and you can do whatever you want with it."
**The "total earned" line says:** "Here's how much this venue has given you. Your balance is lower? That's because you exercised your freedom."

The confusion of "balance < stamps suggest" is the *proof* that Jukesats works. The user exercised sovereign control over their sats. The UI just needs to celebrate that instead of obscuring it.

## Research References

### Code References
- Stamp card: `src/StampCard.tsx`
- Balance display: `App.tsx:337-344`
- Server tap tracking: `server/src/tapTracker.ts`
- Tap endpoint: `server/src/main.ts:370` (POST /tap returns totalTaps)
- User stats: `server/src/main.ts:408` (GET /user-stats/:address)
- Reward constant: `App.tsx:21` (REWARD_SATS = 330)

### Academic Research
- Kahneman & Tversky (1979): Prospect Theory — losses weighted ~2x vs. gains
- Nunes & Dreze (2006): Endowed Progress Effect — head starts increase completion by 78%; reversing progress feels like theft
- Kivetz, Urminsky & Zheng (2006): Goal Gradient Hypothesis — users accelerate near goals; reversing near-goal progress is devastating
- Koo & Fishbach (2012): Small-Area Hypothesis — backward progress changes motivational framing
- Thaler (1980): Endowment Effect — users "own" their progress
- Dreze & Nunes (2011): Status demotion → 25-30% spending reduction
- Arkes & Blumer (1985): Sunk Cost Psychology — lost progress drives abandonment

### Bitcoin Rewards UX
- **Fold**: Spin wheel + tier system, no punch cards. Went public on Nasdaq Feb 2025. 68B+ sats earned across all users.
- **Shakepay**: Streak mechanic (21→1000 sats/day). Missing one day resets entire streak. Extreme loss aversion design.
- **Lolli**: Clear pending/available separation. Partnered with Spark for instant Lightning withdrawals.
- **Satsback**: Zero gamification. Auto-payout to Lightning Address.
- **THNDR**: Non-monetary tickets → lottery → sats paid out. Separates engagement from money.
- **Stacker News**: Cowboy Credits (non-withdrawable, decaying) vs. real sats. Most sophisticated earned-vs-held system.

### Dual-Track UX Patterns
- **Starbucks**: Star balance (number) + tier progress (bar) — different visual formats prevent confusion
- **Delta SkyMiles**: Redeemable miles (number) + medallion progress (circles) — format differentiation
- **Robinhood**: Portfolio value (hero number) + daily return (secondary) — actionable metric is always the hero
- **Dark Souls**: Levels (permanent) + souls (volatile) — the definitive gaming dual-track

### Coffee & Bitcoin Economics
- 3,300 sats ≈ $2.27 at ~$69K BTC (Feb 2026). At $150K → $4.95 (a real coffee).
- Venue CAC via Jukesats: ~$2.27 per 10-visit loyal customer vs. $20 industry average (9x cheaper)
- Big Sats Index: Bitcoin's Big Mac Index dropped below 10K sats/Big Mac in March 2024
- No formal "Coffee Standard" exists yet — branding opportunity
- Bitcoin circular economies (Bitcoin Beach, Bitcoin Lake, Bitcoin Ekasi) have no formal loyalty programs — Jukesats fills this gap

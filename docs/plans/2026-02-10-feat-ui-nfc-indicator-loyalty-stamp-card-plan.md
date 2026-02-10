# Plan: NFC Indicator + Loyalty Stamp Card UI

## Context
The current "Tap for Sats" button is misleading — users think they need to tap the screen, but the actual interaction is tapping a physical NFC tag. The UI needs to communicate "tap an NFC tag" visually, and add a loyalty stamp card showing progress toward rewards.

## Phase 1: Server — Public Tap Count + Bug Fix

### 1a. Fix `getUserStats` to only count completed taps
The current `stmtUserStats` query counts ALL taps including failed ones. This inflates the stamp count.

**File:** `server/src/tapTracker.ts` (line 80-85)
```sql
-- Current (buggy):
SELECT COUNT(*) ... FROM taps WHERE user_ark_address = ?

-- Fixed:
SELECT COUNT(*) ... FROM taps WHERE user_ark_address = ? AND status = 'completed'
```
Also fix `stmtUserVenues` (line 88) to filter by `status = 'completed'`.

### 1b. Add `totalTaps` to `/tap` success response
After a successful tap, include the user's total completed tap count in the response so the client can update the stamp card immediately without a second round-trip.

**File:** `server/src/main.ts`
- In `processTap()`, after `completeTap()` succeeds, query the user's total completed taps
- Add new prepared statement: `stmtUserTapCount` → `SELECT COUNT(*) as count FROM taps WHERE user_ark_address = ? AND status = 'completed'`
- Return `totalTaps` in the success response

### 1c. Add public `/user-stats/:userArkAddress` endpoint
The existing `/stats/:userArkAddress` is admin-only. The client needs a lightweight public endpoint to fetch the tap count on startup (for stamp card display).

**File:** `server/src/main.ts`
- New `GET /user-stats/:userArkAddress` endpoint (no auth)
- Validate address format with `ARK_ADDRESS_RE`
- Return only `{ totalTaps: number }` — minimal data, no sensitive info
- Uses the fixed `getUserStats` under the hood

## Phase 2: Client — Remove "Tap for Sats" + Add NFC Icon

### 2a. Replace "Tap for Sats" button with NFC indicator
Remove the `<Pressable style={styles.tapButton}>` block entirely. Replace the `<Text style={styles.logo}>` with a row containing the logo + NFC icon.

**File:** `App.tsx`
- Import `MaterialCommunityIcons` from `@expo/vector-icons` (already bundled with Expo)
- Replace logo `<Text>` with a `<View style={styles.headerRow}>` containing:
  - `<Text style={styles.logo}>Jukesats</Text>`
  - `<MaterialCommunityIcons name="contactless-payment" size={28} color="#f7931a" />`
- The icon communicates NFC visually without needing a button

### 2b. Add NFC indicator to all screen states
Update `loading`, `error`, and `rateLimited` screens to also show the NFC icon beside the logo for consistency.

## Phase 3: Client — Loyalty Stamp Card

### 3a. Create `StampCard` component
**New file:** `src/StampCard.tsx`

Layout:
- 2 rows x 5 columns grid of circular stamps
- Empty stamp: dashed border circle (#333 border)
- Filled stamp: solid `#f7931a` circle with `MaterialCommunityIcons name="boombox"` icon in white
- Stamps fill left-to-right, top-to-bottom
- Uses `count % 10` so the card resets after every 10 taps (perpetual loyalty loop)

Props:
```typescript
interface StampCardProps {
  tapCount: number  // total completed taps
}
```

Visual spec:
- Stamp size: 44x44px circles
- Gap: 12px between stamps
- Container: subtle border (#222), rounded corners, padding 16px
- Label above: "TAP CARD" in uppercase, color #888, letterSpacing 2
- Below stamps: "X/10" counter text

### 3b. Animate stamp fill on tap success
When a new tap succeeds, the newly filled stamp should have a brief spring bounce animation (scale 0 → 1.1 → 1.0 over 400ms) to give satisfying feedback.

### 3c. Fetch tap count on startup
In `coldStart()`, after wallet init, fetch the user's tap count from the new `/user-stats/:userArkAddress` endpoint. Store in component state alongside the existing `AppState`.

**File:** `App.tsx`
- Add `tapCount` state: `const [tapCount, setTapCount] = useState(0)`
- After getting the address in `coldStart()`, fetch tap count
- After successful tap (in `handleTapResult`), update `tapCount` from the `totalTaps` field in the tap response
- Pass `tapCount` to `<StampCard tapCount={tapCount} />`

### 3d. Place stamp card in the ready screen layout
New layout order:
1. Header row (logo + NFC icon)
2. **Stamp card** (new)
3. Balance
4. Send / Receive buttons

## Phase 4: Deploy

### 4a. Deploy server changes to Fly.io
Server changes (Phase 1) must deploy first so the new endpoint exists when the client calls it.

### 4b. Build and test on iOS simulator
Verify the stamp card renders correctly with 0 taps, partial taps, and full (10/10) taps.

## Files to modify
- `server/src/tapTracker.ts` — fix getUserStats query, add stmtUserTapCount
- `server/src/main.ts` — add totalTaps to tap response, add public user-stats endpoint
- `App.tsx` — remove Tap for Sats button, add NFC icon, add StampCard, fetch tap count
- `src/StampCard.tsx` — **new file** — stamp card component

## Design Decisions
- **Global tap count** (not per-venue) — simpler for users who visit multiple venues
- **Perpetual card (count % 10)** — no "completion" state needed, card resets automatically
- **No extra animation library** — uses React Native's built-in `Animated` API
- **No local persistence of tap count** — fetched from server on each cold start, updated in-memory on each tap. Simple and always accurate.
- **Public endpoint returns minimal data** — only `totalTaps`, no addresses or transaction details

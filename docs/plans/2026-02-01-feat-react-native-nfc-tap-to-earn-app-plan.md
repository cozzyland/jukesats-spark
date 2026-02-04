---
title: "feat: React Native NFC Tap-to-Earn App"
type: feat
date: 2026-02-01
updated: 2026-02-04
---

# React Native NFC Tap-to-Earn App for Jukesats

## Implementation Status (Updated 2026-02-04)

**Repo:** `https://github.com/cozzyland/jukesats-app` — monorepo (Expo app at root, server in `server/`)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Server Hardening | **DONE** | All tasks complete, compiles clean |
| Phase 2: App Setup + Wallet + Deep Links | **DONE** | All tasks complete, compiles clean |
| Phase 3: UI States | **DONE** | Single-screen UI with all overlays built |
| Phase 3: EAS Build config | **DONE** | `eas.json` created |
| Phase 3: Build & TestFlight | **NOT STARTED** | Needs Apple Developer account, signing |
| NFC end-to-end testing | **NOT STARTED** | Needs physical device + NFC tags |

### Critical SDK Finding

**`SingleKey.toAddress()` does NOT exist** in `@arkade-os/sdk`. The plan originally assumed synchronous address derivation, but the SDK requires `wallet.getAddress()` which is async and needs the ARK server's public key (network call). This means:
- First-time users MUST go through full `initWallet()` before any tap can be submitted
- Returning users with a cached address (from AsyncStorage) can still do parallel tap + wallet init
- The wallet service exports `getCachedAddress()` for the fast path

### Architecture Change from Plan

The plan originally said "creates a new repo" for the app only, with server staying in `jukesats`. Instead, `jukesats-app` is a **monorepo** — server source lives in `server/`, Expo app at root. The `jukesats` repo remains as PWA legacy only.

### Key Files

| File | Description |
|------|-------------|
| `App.tsx` | Single-screen app with 5 state overlays, deep link handling |
| `src/wallet.ts` | ARK wallet service with dedup promise, cached address |
| `src/polyfills.ts` | `expo-crypto` getRandomValues shim |
| `metro.config.js` | Package exports + inline requires |
| `index.ts` | Entry point, imports polyfills first |
| `app.json` | Deep links, NFC description, bundle IDs |
| `eas.json` | EAS Build profiles (dev/preview/production) |
| `server/src/main.ts` | Express server with hardened /tap endpoint |
| `server/src/tapTracker.ts` | Rate limiting, IP tracking, spend cap |
| `server/src/hotWallet.ts` | ARK wallet for dispensing sats |
| `server/src/bootstrap.ts` | Server startup |
| `server/fly.toml` | Fly.io deployment config |
| `server/public/` | .well-known files, fallback tap.html |

---

## Overview

Build a React Native (Expo) mobile app for iOS and Android that enables users to earn Bitcoin (sats) by tapping their phone on NFC tags at partner cafes. Monorepo: Expo app at root, server in `server/`.

NFC tag reading is handled by the phone's OS via deep links (Universal Links on iOS, App Links on Android) — no NFC library required. The ARK SDK has first-class Expo support with dedicated adapters.

## Problem Statement

The current PWA cannot read NFC tags on iOS (Apple blocks Web NFC). A native app is required. The Squid loyalty app (500K+ users, 2000+ retailers) validates this approach: native app + simple NFC tags at venues.

## Architecture

```
NFC Tag (NTAG213)           Phone OS                 Expo App                  Existing Server
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ NDEF URL:    │     │ Background NFC   │     │ Deep link handler│     │ POST /tap        │
│ cozzyland.net│────>│ reader detects   │────>│ Parses venue ID  │────>│ Rate limit check │
│ /tap?venue=  │     │ tag, opens app   │     │ Sends tap request│     │ Send 330 sats    │
│ cafe_123&tag=│     │ via deep link    │     │ Updates balance  │     │ via ARK protocol │
│ tag_456      │     └──────────────────┘     └──────────────────┘     └──────────────────┘
└──────────────┘
```

**Single-screen app.** One view with overlays for loading, tap result, errors, rate limiting. No navigation library.

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Expo (React Native) | ARK SDK has built-in Expo adapters |
| NFC handling | OS deep links (no NFC library) | URL tags read natively by iOS/Android |
| Wallet state | `AsyncStorageAdapter` (SDK built-in) | Ships with @arkade-os/sdk |
| Private keys | `expo-secure-store` | Hardware-backed iOS Keychain / Android Keystore |
| SSE streaming | `ExpoArkProvider` + `ExpoIndexerProvider` | SDK built-in, uses expo/fetch |
| Crypto polyfill | `expo-crypto` (~10KB) | SDK only needs `getRandomValues()` — not full `react-native-quick-crypto` |
| Address derivation | `wallet.getAddress()` (async) | `SingleKey.toAddress()` does NOT exist — requires ARK server pubkey |
| NFC tags | NDEF URL (NTAG213, ~$0.10/tag) | Sufficient with server-side rate limiting |
| Dev builds | Expo prebuild (no Expo Go) | Custom dev client required |

## Implementation Phases

### Phase 1: Server Hardening

**Goal:** Close security gaps before making NFC tapping easier.

The server has live vulnerabilities that must be fixed first. The Sybil attack vector (unlimited wallet creation bypasses per-address rate limiting) and open admin endpoints are the highest priority.

**Tasks:**

- [x] **Add IP-based rate limiting** as secondary layer (max 10 taps/hour per IP) — prevents Sybil attack where attacker generates new wallet per request
- [x] **Add daily hot wallet spend cap** — hard limit on total sats dispensed per day
- [x] **Add Bearer token auth to admin endpoints** (`/admin/*`) — currently zero authentication
- [x] **Add venue whitelist** — validate venueId against `ALLOWED_VENUES` env var
- [x] **Disable `/simulate-tap` in production** via env flag — currently an open faucet
- [x] **Fix `tapTracker.getUserStats()`** — uses hardcoded 100 instead of actual 330 sats
- [x] **Align `DEFAULT_REWARD_SATS`** to 330 across server config
- [x] **Deploy `.well-known` files to cozzyland.net** (needed for Phase 2 deep links):

AASA for iOS (`/.well-known/apple-app-site-association`):
```json
{
  "applinks": {
    "details": [{
      "appIDs": ["TEAMID.com.jukesats.app"],
      "components": [{ "/": "/tap*" }]
    }]
  }
}
```

assetlinks.json for Android (`/.well-known/assetlinks.json`):
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.jukesats.app",
    "sha256_cert_fingerprints": ["SHA256_FROM_KEYSTORE"]
  }
}]
```

- [x] **Add fallback web page** at `cozzyland.net/tap` — redirect to App Store / Play Store or existing PWA

**AASA gotcha:** Apple caches aggressively. Must be correct **before** first TestFlight build. Serve with `Content-Type: application/json`. Test with `curl -v https://cozzyland.net/.well-known/apple-app-site-association`.

**Success criteria:**
- [x] Server rejects unknown venue IDs
- [x] Admin endpoints require authentication
- [x] `/simulate-tap` disabled in production
- [x] IP-based rate limiting active
- [x] `.well-known` files serving correctly

---

### Phase 2: App Setup, Wallet, Deep Links & Tap Flow

**Goal:** New Expo project where tapping an NFC tag earns sats.

**Tasks — Project Setup:**

- [x] Create new GitHub repo `jukesats-app`
- [x] Initialize: `npx create-expo-app jukesats-app --template blank-typescript`
- [x] Install dependencies:

```bash
npx expo install expo-crypto expo-secure-store expo-linking expo-splash-screen @react-native-async-storage/async-storage
npm install @arkade-os/sdk
```

- [x] Create `src/polyfills.ts` (MUST be imported first, before any SDK imports):

```typescript
// src/polyfills.ts
import * as Crypto from 'expo-crypto'
if (!global.crypto) {
  // @ts-expect-error -- shimming getRandomValues for React Native
  global.crypto = {} as Crypto
}
global.crypto.getRandomValues = Crypto.getRandomValues
```

- [x] Configure `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config')
const config = getDefaultConfig(__dirname)

config.transformer.getTransformOptions = async () => ({
  transform: { inlineRequires: true },
})
config.resolver.unstable_enablePackageExports = true

module.exports = config
```

- [x] Configure deep links in `app.json`:

```json
{
  "expo": {
    "scheme": "jukesats",
    "ios": {
      "bundleIdentifier": "com.jukesats.app",
      "associatedDomains": ["applinks:cozzyland.net"],
      "infoPlist": {
        "NFCReaderUsageDescription": "Jukesats uses NFC to detect tap points at cafes."
      }
    },
    "android": {
      "package": "com.jukesats.app",
      "intentFilters": [{
        "action": "VIEW",
        "autoVerify": true,
        "data": [{ "scheme": "https", "host": "cozzyland.net", "pathPrefix": "/tap" }],
        "category": ["BROWSABLE", "DEFAULT"]
      }]
    }
  }
}
```

- [ ] Run `npx expo prebuild` to generate native projects (deferred — EAS Build handles this)

**Tasks — Wallet Service (`src/wallet.ts`):**

```typescript
import { Wallet, SingleKey } from '@arkade-os/sdk'
import { AsyncStorageAdapter } from '@arkade-os/sdk/adapters/asyncStorage'
import { ExpoArkProvider, ExpoIndexerProvider } from '@arkade-os/sdk/adapters/expo'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

const ARK_SERVER_URL = 'https://arkade.computer'
const PRIVATE_KEY_KEY = 'wallet-private-key'
const CACHED_ADDRESS_KEY = 'wallet-ark-address'

let wallet: Wallet | null = null
let address: string | null = null
let initPromise: Promise<string> | null = null

/** Initialize wallet. Safe to call concurrently — deduplicates via shared promise. */
export function initWallet(): Promise<string> {
  if (!initPromise) {
    initPromise = doInit()
  }
  return initPromise
}

async function doInit(): Promise<string> {
  if (wallet && address) return address

  let privateKeyHex = await SecureStore.getItemAsync(PRIVATE_KEY_KEY)
  if (!privateKeyHex) {
    const identity = SingleKey.fromRandomBytes()
    privateKeyHex = identity.toHex()
    await SecureStore.setItemAsync(PRIVATE_KEY_KEY, privateKeyHex, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  }

  wallet = await Wallet.create({
    identity: SingleKey.fromHex(privateKeyHex),
    arkServerUrl: ARK_SERVER_URL,
    storage: new AsyncStorageAdapter(),
    arkProvider: new ExpoArkProvider(ARK_SERVER_URL),
    indexerProvider: new ExpoIndexerProvider(ARK_SERVER_URL),
  })

  // NOTE: wallet.address does NOT exist. Must use getAddress() which is async.
  address = await wallet.getAddress()
  await AsyncStorage.setItem(CACHED_ADDRESS_KEY, address)
  return address
}

export function getWallet(): Wallet {
  if (!wallet) throw new Error('Wallet not initialized')
  return wallet
}

export function getAddress(): string | null {
  return address
}
```

**Key design decisions in wallet service:**
- **Deduplication promise** — concurrent `initWallet()` calls share one promise, preventing double key generation on first launch
- **Cached address** — stored in AsyncStorage after init for fast cold starts (~10ms read vs ~100ms SecureStore)
- **⚠️ `identity.toAddress()` does NOT exist** — address derivation requires `wallet.getAddress()` (async, needs ARK server pubkey). First-time users must complete `initWallet()` before tapping. Returning users use `getCachedAddress()` for parallel tap optimization.
- **4 exported functions** — `initWallet()`, `getWallet()`, `getAddress()`, `getCachedAddress()`. The actual `src/wallet.ts` is the source of truth.

**Tasks — App Entry (`App.tsx`):**

> **⚠️ The code below is the ORIGINAL PLAN and contains bugs.** The actual implementation is in `App.tsx` (source of truth). Key differences:
> - `SingleKey.toAddress()` doesn't exist — replaced with `getCachedAddress()` + `initWallet()`
> - `useLinkingURL()` replaced with `Linking.addEventListener('url', ...)` for warm links
> - `submitTap` returns a result object (not throw-based), properly handles `retryAfterMs`
> - `handleTapResult()` extracted as shared helper for cold start and warm tap paths
> - Full UI with styles, animations, and all 5 state overlays is in `App.tsx`
>
> **Read `App.tsx` directly — don't copy from this plan.**

**Bugs fixed from review:**
- `initWallet()` uses deduplication promise — concurrent calls cannot create two private keys
- `Promise.all` replaced with independent handling — tap result is never lost if wallet init fails
- `SplashScreen.hideAsync()` in `finally` block — app never stuck on splash screen
- `parseDeepLink` uses `=== '/tap'` not `startsWith('/tap')` — won't match `/tapping`
- `submitTap` returns result object instead of throwing — no custom error class needed
- `X-Client-Type` header removed — nothing reads it (YAGNI)

**Tasks — NFC Testing:**

- [ ] Update NFC tag URL: `https://cozzyland.net/tap?venue=test_cafe&tag=test_tag_001`
- [ ] Test on physical iPhone (XR+) — background tap → app opens → reward
- [ ] Test on physical Android — tap → app opens → reward
- [ ] Test rate limiting — tap twice within 60s → shows rate limit message
- [ ] Test cold start deep link (app not running → tag tap → reward)

**Success criteria:**
- [ ] App builds and runs on iOS simulator and Android emulator
- [ ] Wallet creates successfully (no crypto errors)
- [ ] NFC tag tap opens app and awards sats on both platforms
- [ ] Rate limiting works correctly
- [ ] Cold start deep link works

---

### Phase 3: UI Polish, Build & Distribution

**Goal:** Polished app available for testing via TestFlight / internal APK.

**Tasks — UI:**

- [x] Build single-screen layout with balance display
- [x] Add tap reward overlay animation ("+330 sats earned!")
- [x] Add loading state during wallet initialization
- [x] Add error overlays: network down, ARK coordinator unreachable
- [x] Show wallet ARK address
- [x] Handle balance refresh after tap (tap on balance to refresh)

**UI States (single screen, overlays):**

| State | Trigger | Display |
|-------|---------|---------|
| Loading | Cold start | Logo + spinner |
| Ready | Wallet initialized | Balance, address |
| Tap Success | API returns 200 | "+330 sats!" overlay |
| Rate Limited | 429 from server | Countdown overlay |
| Error | Network failure | Error + retry button |

**Tasks — Build:**

- [x] Set up EAS Build (`eas.json`):
  ```json
  {
    "build": {
      "development": { "developmentClient": true, "distribution": "internal" },
      "preview": { "distribution": "internal" },
      "production": {}
    }
  }
  ```
- [ ] Configure iOS signing (Apple Developer Organization account — needs DUNS number, apply early)
- [ ] Configure Android signing (keystore)
- [ ] Build dev client: `eas build --profile development --platform all`
- [ ] Build for TestFlight: `eas build --profile preview --platform ios`
- [ ] Submit to TestFlight
- [ ] Build Android APK for internal testing
- [ ] End-to-end test on physical devices with real NFC tags

**Success criteria:**
- [ ] Smooth cold start → loading → ready transition
- [ ] Tap reward provides clear visual feedback
- [ ] App installable via TestFlight on iOS and APK on Android
- [ ] Full NFC tap-to-earn flow works on physical devices

---

## Known Gaps

| Gap | Severity | Resolution |
|-----|----------|------------|
| `nfcTagId` missing from URL | Critical | URL format: `/tap?venue=cafe_123&tag=tag_456` |
| No fallback page when app not installed | Critical | Cloudflare Worker serves landing page at `/tap` |
| Venue abuse (arbitrary venue IDs) | Critical | Phase 1: venue whitelist |
| Sybil wallet drain | Critical | Phase 1: IP rate limiting + daily spend cap |
| Cold start > 3s | Medium | Cached address + parallel tap pattern |
| PWA → native wallet migration | Low | Out of v1 scope |
| VTXOs expire after 28 days | Low | Out of v1 scope — VtxoManager handles on app open |
| ExpoArkProvider has no SSE auto-reconnect | Low | Implement if/when SSE is used |

## Dependencies

| Dependency | Status | Blocker? |
|------------|--------|----------|
| Apple Developer Organization account | Need DUNS number | Blocks TestFlight |
| `expo-crypto` polyfill | ✅ Verified | — |
| `@arkade-os/sdk` Expo adapters | ✅ Verified (v0.3.12, Expo 54) | — |
| `.well-known` files on cozzyland.net | ✅ Done (served from server) | — |
| Physical NFC tags (NTAG213) | Need to purchase | Blocks Phase 2 testing |
| AASA correct before first TestFlight | Phase 1 task | Blocks iOS deep links |

## Acceptance Criteria

- [ ] NFC tag tap awards sats on both iOS and Android (needs device testing)
- [x] First-time users get wallet created automatically (code complete)
- [x] Balance updates after each tap (code complete — tap balance to refresh)
- [x] Rate limiting works (1 tap/min/venue per user + IP-based) (server code complete)
- [x] Cold start, warm start, and already-open deep links all work (code complete)
- [x] Admin endpoints require authentication
- [x] Daily hot wallet spend cap active
- [ ] Cold start to reward < 5s (stretch: < 3s) (needs device measurement)
- [x] Private keys in hardware-backed secure storage (`expo-secure-store`)
- [ ] Tested on physical iPhone (XR+) and Android with real NFC tag

## References

- PWA wallet: [pwa/src/wallet.ts](pwa/src/wallet.ts)
- Server /tap: [server/src/main.ts:156-180](server/src/main.ts#L156-L180)
- Brainstorm: [docs/brainstorms/2026-02-01-nfc-native-app-brainstorm.md](docs/brainstorms/2026-02-01-nfc-native-app-brainstorm.md)
- [ARK SDK](https://github.com/arkade-os/ts-sdk) · [Expo Linking](https://docs.expo.dev/guides/linking/) · [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) · [EAS Build](https://docs.expo.dev/build/introduction/) · [Apple Universal Links](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)

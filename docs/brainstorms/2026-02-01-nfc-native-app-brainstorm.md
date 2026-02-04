# Brainstorm: NFC Native App for Jukesats

**Date:** 2026-02-01
**Status:** Complete
**Next step:** `/workflows:plan`

---

## What We're Building

A React Native (Expo) mobile app for iOS and Android that lets users earn Bitcoin (sats) by tapping their phone on NFC tags at partner cafes. This is a native companion to the existing Jukesats PWA, talking to the same backend server.

### Core Flow

1. Cafe has a physical NFC tag (NTAG213/215) at the counter, encoded with a URL like `https://cozzyland.net/tap?venue=cafe_123`
2. User's phone detects the NFC tag in the background (no need to open the app first)
3. OS launches/foregrounds the Jukesats app with the tag data
4. App extracts venue ID from the tag URL
5. App calls existing server `POST /tap` with `{userArkAddress, venueId, nfcTagId}`
6. Server validates rate limit (1 tap/min/venue) and sends 100+ sats reward via ARK protocol
7. App shows reward confirmation, updated balance

### What It Is NOT

- Not a replacement for the PWA (PWA stays alive as web fallback)
- Not a new server (reuses existing jukesats-server on Fly.io)
- Not using cryptographic NFC tags (simple NDEF URL tags for now)
- Not a payment app (earn-only for v1, spending comes later)

---

## Why This Approach

### Why native app instead of staying PWA?

- **iOS NFC support**: Apple blocks Web NFC entirely. A native app using CoreNFC is the only way to read NFC on iPhone
- **Background tag reading**: On iPhone XR+ and most Android, the OS can detect NFC tags without the app being open. PWAs cannot do this
- **Better security**: Native keychain/keystore for wallet private keys vs. browser IndexedDB
- **Squid model proven**: Squid loyalty (500K+ users, 2000+ retailers) uses the exact same approach: native app + simple NFC tags at venues

### Why Expo over bare React Native?

- Faster setup and iteration
- ARK SDK has **first-class Expo support** (`ExpoArkProvider`, `ExpoIndexerProvider`)
- `AsyncStorageAdapter` ships with the SDK for React Native storage
- OTA updates for JS changes without App Store review
- Can eject to bare if we hit native limitations
- EAS Build for cloud builds

### Why simple NDEF URL tags over NTAG424 DNA?

- Cost: ~$0.10 vs ~$1-2 per tag
- Simplicity: No cryptographic programming needed
- Sufficient security: Server-side rate limiting (1 tap/min/venue) prevents abuse
- Upgrade path: Can move to NTAG424 DNA later without changing the app (just the tag contents change)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Platform | React Native (Expo) | Full NFC on iOS + Android, fast setup |
| NFC tags | Simple NDEF URL (NTAG213/215) | Cheap, sufficient with server-side rate limiting |
| NFC read mode | Background tag reading via deep links | No NFC library needed for URL tags — OS handles it |
| Server | Reuse existing jukesats-server | API already has /tap endpoint, no changes needed |
| Private key storage | `expo-secure-store` (Keychain/Keystore) | Hardware-backed encryption, separate from wallet state |
| Wallet state storage | `AsyncStorageAdapter` (SDK built-in) | Ships with @arkade-os/sdk, no custom adapter needed |
| SSE/EventSource | `ExpoArkProvider` + `ExpoIndexerProvider` | SDK built-in Expo providers, uses expo/fetch for SSE |
| Repo structure | New repo (separate from PWA) | Clean separation, PWA stays as web fallback |

---

## Architecture Overview

```
                    NFC Tag (NTAG213)
                    ┌──────────────┐
                    │ NDEF URL:    │
                    │ cozzyland.   │
                    │ net/tap?     │
                    │ venue=cafe1  │
                    └──────┬───────┘
                           │ tap
                    ┌──────▼───────┐
                    │  Phone OS    │
                    │ (iOS/Android)│
                    │ Background   │
                    │ NFC reader   │
                    └──────┬───────┘
                           │ Universal Link / App Link
                    ┌──────▼───────┐
                    │ React Native │
                    │  Expo App    │
                    │              │
                    │ - Parse URL  │
                    │ - ARK wallet │
                    │ - SecureStore│
                    └──────┬───────┘
                           │ POST /tap
                    ┌──────▼───────┐
                    │  Existing    │
                    │  Server      │
                    │ (Fly.io)     │
                    │              │
                    │ - Rate limit │
                    │ - Send sats  │
                    │ - ARK hot    │
                    │   wallet     │
                    └──────────────┘
```

---

## ARK SDK Adaptation (Deep Dive)

### Key Finding: SDK Has First-Class Expo Support

The `@arkade-os/sdk` v0.3.11 ships with dedicated Expo adapters. No polyfills or custom storage adapters needed.

### SDK Exports for React Native

```
@arkade-os/sdk                      → Core: Wallet, SingleKey, waitForIncomingFunds, VtxoManager
@arkade-os/sdk/adapters/asyncStorage → AsyncStorageAdapter (React Native)
@arkade-os/sdk/adapters/expo         → ExpoArkProvider, ExpoIndexerProvider (SSE via expo/fetch)
```

### StorageAdapter Interface

```typescript
interface StorageAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  clear(): Promise<void>
}
```

### Ported Wallet Initialization (PWA → React Native)

**PWA version (current):**
```typescript
import { IndexedDBStorageAdapter } from '@arkade-os/sdk/adapters/indexedDB'

const storage = new IndexedDBStorageAdapter('jukestats-wallet', 1)
let privateKeyHex = await storage.getItem('wallet-private-key')
// ... create identity ...
this.wallet = await Wallet.create({
  identity,
  arkServerUrl: 'https://arkade.computer',
  storage,
})
```

**React Native version:**
```typescript
import { AsyncStorageAdapter } from '@arkade-os/sdk/adapters/asyncStorage'
import { ExpoArkProvider, ExpoIndexerProvider } from '@arkade-os/sdk/adapters/expo'
import * as SecureStore from 'expo-secure-store'

// Private key in hardware-backed secure storage (NOT in AsyncStorage)
let privateKeyHex = await SecureStore.getItemAsync('wallet-private-key')
if (!privateKeyHex) {
  const newIdentity = SingleKey.fromRandomBytes()
  privateKeyHex = newIdentity.toHex()
  await SecureStore.setItemAsync('wallet-private-key', privateKeyHex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

const identity = SingleKey.fromHex(privateKeyHex)

// Wallet state in AsyncStorage, SSE via Expo providers
const storage = new AsyncStorageAdapter()
const arkProvider = new ExpoArkProvider('https://arkade.computer')
const indexerProvider = new ExpoIndexerProvider('https://arkade.computer')

this.wallet = await Wallet.create({
  identity,
  arkServerUrl: 'https://arkade.computer',
  storage,
  arkProvider,
  indexerProvider,
})
```

### What Changes vs. PWA

| Component | PWA | React Native | Change Required |
|-----------|-----|-------------|----------------|
| Storage adapter | `IndexedDBStorageAdapter` | `AsyncStorageAdapter` | Swap import (1 line) |
| Private key | `storage.setItem()` | `SecureStore.setItemAsync()` | Move to secure storage |
| SSE providers | Default (browser EventSource) | `ExpoArkProvider` + `ExpoIndexerProvider` | Pass to Wallet.create() |
| Balance/send/history | Same API | Same API | No change |
| `waitForIncomingFunds` | Works via EventSource | Should work via Expo providers | Verify |
| VtxoManager | Same API | Same API | No change |

### Dependencies Needed

```json
{
  "@arkade-os/sdk": "^0.3.11",
  "@react-native-async-storage/async-storage": "^1.x",
  "expo-secure-store": "~3.x",
  "expo-linking": "~7.x"
}
```

### Risk: `waitForIncomingFunds()` Compatibility

The `waitForIncomingFunds()` function uses SSE internally. With the Expo providers, the SDK uses `expo/fetch` for SSE streaming instead of browser `EventSource`. This *should* work, but needs testing since:
- The function may internally create its own provider rather than using the one passed to `Wallet.create()`
- If it does, we may need the `rn-eventsource-reborn` polyfill as a fallback

**Mitigation:** Test early. If `waitForIncomingFunds` doesn't work with Expo providers, use polling (`wallet.getBalance()` on an interval) as a simpler fallback.

---

## Crypto Polyfills (Critical)

### The Problem

React Native's Hermes engine lacks `crypto.getRandomValues()` and `crypto.subtle`. The ARK SDK's dependencies (`@noble/secp256k1@3.0.0`, `@noble/curves@2.0.0`, `@scure/btc-signer@2.0.1`) need these for key generation, transaction signing, and Schnorr/musig2 operations. **Without polyfills, the app will crash on wallet creation.**

### The Solution: `react-native-quick-crypto`

Native C/C++ crypto module via JSI. Standard solution for Bitcoin wallets in React Native (used by BlueWallet, etc).

**Packages needed:**
```bash
npx expo install react-native-quick-crypto
npm install @craftzdog/react-native-buffer
```

**Entry point setup (MUST be first imports):**
```typescript
// 1. Install native crypto on globalThis (getRandomValues + subtle)
import { install } from 'react-native-quick-crypto'
install()

// 2. Buffer polyfill
import { Buffer } from '@craftzdog/react-native-buffer'
globalThis.Buffer = Buffer

// 3. Now safe to import @arkade-os/sdk
import { Wallet, SingleKey } from '@arkade-os/sdk'
```

**Metro config (`metro.config.js`):**
```js
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'crypto')
    return context.resolveRequest(context, 'react-native-quick-crypto', platform)
  if (moduleName === 'buffer')
    return context.resolveRequest(context, '@craftzdog/react-native-buffer', platform)
  return context.resolveRequest(context, moduleName, platform)
}
```

### Impact on Development Workflow

- **Cannot use Expo Go** — native modules require custom dev builds
- Must use `npx expo prebuild` to generate native iOS/Android projects
- Need Xcode for iOS simulator testing
- EAS Build for cloud builds / CI
- This is standard for any Bitcoin wallet app in Expo

### What the Polyfill Enables

| Operation | Without Polyfill | With `react-native-quick-crypto` |
|-----------|-----------------|----------------------------------|
| `SingleKey.fromRandomBytes()` | Crashes | Works |
| `wallet.sendBitcoin()` | Crashes (signAsync) | Works |
| `schnorr.sign()` (musig2) | Crashes | Works |
| `Wallet.create()` | Crashes | Works |

---

## NFC Implementation Details

### Key Insight: No NFC Library Needed for URL Tags

For NDEF URL tags, the phone's OS handles NFC reading natively. The app just needs to handle **deep links**.

### Tag Format

Tags contain a single NDEF URL record:
```
https://cozzyland.net/tap?venue={venueId}
```

### iOS: Universal Links

- iPhone XR+ continuously scans for NFC tags when display is on
- When tag URL matches a registered Universal Link, iOS shows a notification
- User taps notification → app opens/foregrounds with the URL
- Setup: Register `applinks:cozzyland.net` in Associated Domains + host `apple-app-site-association`

### Android: App Links

- Register intent filter for `NDEF_DISCOVERED` with URL pattern
- OS reads tag → matches intent → opens app with URL data
- Works even when app is not running
- Setup: Register intent filter in `app.json` + host `assetlinks.json`

### Expo Configuration

```json
{
  "expo": {
    "scheme": "jukesats",
    "ios": {
      "associatedDomains": ["applinks:cozzyland.net"],
      "infoPlist": {
        "NFCReaderUsageDescription": "Jukesats uses NFC to detect tap points at cafes."
      }
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "https", "host": "cozzyland.net", "pathPrefix": "/tap" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### Server-Side Files Needed

**`/.well-known/apple-app-site-association`** (on cozzyland.net):
```json
{
  "applinks": {
    "details": [{ "appID": "TEAMID.com.jukesats.app", "paths": ["/tap/*"] }]
  }
}
```

**`/.well-known/assetlinks.json`** (on cozzyland.net):
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.jukesats.app",
    "sha256_cert_fingerprints": ["YOUR_SHA256"]
  }
}]
```

### Fallback for Older Devices

For iPhone 7/8/X (no background NFC reading), add an in-app "Scan" button using `react-native-nfc-manager`. This is optional for v1.

---

## Notes for Future Exploration

### App Store Compliance (Research Later)

- Need **Organization** Apple Developer account (not individual) — requires DUNS number
- ~40% rejection rate for crypto wallet apps; most rejections are account/compliance issues
- Prepare legal opinion letter documenting self-custody model
- Document that Jukesats never custodies user funds
- Biometric auth for transactions recommended

### Tag Provisioning (Design Later)

- v1: Manually program tags using NFC Tools app (free, iOS + Android)
- Write the NDEF URL record: `https://cozzyland.net/tap?venue={venueId}`
- Tags can be NTAG213 (cheapest, 144 bytes, sufficient for a URL)
- Bulk purchase: ~$0.05-0.15 per tag in packs of 50+
- Future: In-app tag programming feature for venue owners

### Push Notifications (Build Later)

- Notify users when sats arrive (currently uses SSE polling)
- Would need `expo-notifications` + server changes to send push
- Not needed for v1 — the app shows balance updates in real-time via SSE

---

## References

- [Squid Loyalty - How it Works](https://squidloyalty.ie/how-it-works/)
- [Squid Help Center](https://intercom.help/squid/en/articles/8255719-how-squid-works)
- [Web NFC API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API)
- [react-native-nfc-manager](https://github.com/revtel/react-native-nfc-manager)
- [Bolt Card (NFC + Lightning)](https://www.boltcard.org/)
- [ARK SDK TypeScript](https://github.com/arkade-os/ts-sdk)
- [ARK SDK Docs](https://arkade-os.github.io/ts-sdk/)
- [Apple Background Tag Reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading)
- [Expo Config Plugins](https://docs.expo.dev/config-plugins/introduction/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [NFC Tag Types Explained](https://www.rfidcard.com/nfc-card-types-explained-how-to-choose-between-ntag213-ntag215-ntag216-and-ntag424-dna/)
- [Ghost-Tap NFC Security](https://www.sisainfosec.com/blogs/ghost-tap-how-hackers-exploit-nfc-and-mobile-payments/)
- [rn-eventsource-reborn](https://github.com/NepeinAV/rn-eventsource-reborn) (fallback if SDK Expo providers insufficient)

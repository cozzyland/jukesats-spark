import { useState, useEffect, useRef } from 'react'
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  ActivityIndicator,
  Pressable,
  Animated,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as SplashScreen from 'expo-splash-screen'
import * as Linking from 'expo-linking'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { initWallet, getAddress, getWallet, getCachedAddress } from './src/wallet'
import { WithdrawOverlay } from './src/WithdrawOverlay'
import { QRReceiveScreen } from './src/QRReceiveScreen'
import { QRSendScreen } from './src/QRSendScreen'
import { EducationalOverlay } from './src/EducationalOverlay'
import { useAspHealth } from './src/aspHealth'
import { AspHealthBanner } from './src/AspHealthBanner'
import { UnilateralExitOverlay } from './src/UnilateralExitOverlay'

const API_URL = 'https://jukesats-server.fly.dev'
const REWARD_SATS = 330

// --- Educational Content ---

type TooltipKey = 'sats' | 'coffee' | 'stack' | 'send' | 'jukebox'

const TOOLTIPS: Record<TooltipKey, { title: string; content: string[] }> = {
  sats: {
    title: 'What are sats?',
    content: [
      'Sats (short for satoshis) are the smallest unit of Bitcoin. 1 Bitcoin = 100,000,000 sats.',
      "Think of sats like cents to a dollar \u2014 except there will only ever be 21 million Bitcoin. No government can print more.",
      'Every time you tap an NFC tag at the cafe, you earn real sats. They\'re yours \u2014 not loyalty points, not tokens. Real Bitcoin you can spend, save, or send anywhere.',
    ],
  },
  coffee: {
    title: "You're spending real Bitcoin.",
    content: [
      "This isn't a loyalty card trick \u2014 when you buy a coffee, you're sending actual Bitcoin (sats) from your wallet to the cafe's wallet.",
      "The same technology that moves millions across borders is buying your flat white. That's Bitcoin.",
    ],
  },
  stack: {
    title: 'Why saving in Bitcoin beats saving in dollars.',
    content: [
      'Argentina (extreme): A coffee cost 100 pesos in 2020. The same coffee costs 2,500+ pesos in 2026. Your pesos bought 25x less coffee in 6 years.',
      'US/Europe (moderate): A $5 coffee in 2020 costs ~$7 in 2026. Your dollars buy ~30% less coffee.',
      'Bitcoin: 10,000 sats bought a coffee in 2020. Those same 10,000 sats could buy 3+ coffees today. Your sats bought MORE coffee over time.',
      'Every sat you stack today could buy more tomorrow. That\'s the Bitcoin savings thesis.',
    ],
  },
  send: {
    title: 'Your real Bitcoin wallet.',
    content: [
      "This is a Layer 2 (L2) Bitcoin wallet. Your sats are real Bitcoin — not tokens, not IOUs.",
      "Layer 2 means faster, cheaper transactions while still being secured by the Bitcoin network.",
      "Send to a friend's wallet, move to your own hardware wallet, or pay for anything that accepts Bitcoin.",
      'Unlike loyalty points locked to one app, your sats work everywhere on the Bitcoin network.',
    ],
  },
  jukebox: {
    title: 'The Jukesats Jukebox.',
    content: [
      'Spend real Bitcoin to pick songs on the music player at your table. Skip the queue, play your favorite track, tip the playlist.',
      "Your sats aren't just money \u2014 they're your voice in the room.",
      'Coming soon.',
    ],
  },
}

SplashScreen.preventAutoHideAsync()

// --- Types ---

type AppState =
  | { kind: 'loading' }
  | { kind: 'ready'; balance: number; address: string }
  | { kind: 'tapSuccess'; balance: number; address: string; reward: number }
  | { kind: 'rateLimited'; retryAfterSeconds: number }
  | { kind: 'error'; message: string }

type TapResult =
  | { success: true; txid: string; amount: number; totalTaps?: number }
  | { success: false; error: string; retryAfterMs?: number }

// --- Helpers ---

function parseDeepLink(url: string | null): { venueId: string; tagId: string } | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const isTapPath = parsed.pathname === '/tap' || parsed.host === 'tap'
    if (!isTapPath) return null
    const venueId = parsed.searchParams.get('venue')
    if (!venueId) return null
    return { venueId, tagId: parsed.searchParams.get('tag') || 'unknown' }
  } catch {
    return null
  }
}

async function submitTap(
  userArkAddress: string,
  venueId: string,
  nfcTagId: string
): Promise<TapResult> {
  const res = await fetch(`${API_URL}/tap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userArkAddress, venueId, nfcTagId }),
  })

  if (res.status === 429) {
    const body = await res.json().catch(() => ({}))
    return {
      success: false,
      error: 'Rate limited',
      retryAfterMs: body.retryAfterMs ?? 60000,
    }
  }
  if (!res.ok) {
    return { success: false, error: `Tap failed: ${res.status}` }
  }
  const body = await res.json().catch(() => null)
  if (!body || typeof body.success !== 'boolean') {
    return { success: false, error: 'Unexpected server response' }
  }
  return body as TapResult
}

async function fetchTapCount(userArkAddress: string): Promise<number> {
  try {
    const res = await fetch(`${API_URL}/user-stats/${userArkAddress}`)
    if (!res.ok) return 0
    const body = await res.json()
    return typeof body.totalTaps === 'number' ? body.totalTaps : 0
  } catch {
    return 0
  }
}

// --- App ---

export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' })
  const [fadeAnim] = useState(() => new Animated.Value(0))
  const [overlay, setOverlay] = useState<
    | null
    | { kind: 'receive' }
    | { kind: 'scan' }
    | { kind: 'send'; address: string; amount: number | null }
    | { kind: 'exitInfo' }
    | { kind: 'exit' }
  >(null)
  const aspHealth = useAspHealth()
  const [tapCount, setTapCount] = useState(0)
  const [tooltip, setTooltip] = useState<TooltipKey | null>(null)

  // Ref to always access latest handleTap without re-subscribing the listener
  const handleTapRef = useRef(handleTap)
  handleTapRef.current = handleTap

  // Cold start
  useEffect(() => {
    coldStart()
  }, [])

  // Listen for warm deep links (app already open)
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const tap = parseDeepLink(url)
      if (tap) {
        // Close any overlay — tap takes priority
        setOverlay(null)
        handleTapRef.current(tap.venueId, tap.tagId)
      }
    })
    return () => sub.remove()
  }, [])

  // Animate tap success overlay
  useEffect(() => {
    if (state.kind === 'tapSuccess') {
      fadeAnim.setValue(0)
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // After animation, transition to ready
        if (state.kind === 'tapSuccess') {
          setState({
            kind: 'ready',
            balance: state.balance,
            address: state.address,
          })
        }
      })
    }
  }, [state.kind])

  async function coldStart() {
    try {
      const initialUrl = await Linking.getInitialURL()
      const tapParams = parseDeepLink(initialUrl)

      // Try cached address first (~10ms from AsyncStorage)
      const cachedAddr = await getCachedAddress()

      if (cachedAddr && tapParams) {
        // FAST PATH: returning user + tap. Run tap + wallet init in parallel.
        const tapPromise = submitTap(cachedAddr, tapParams.venueId, tapParams.tagId)
        const walletPromise = initWallet()

        const tapResult = await tapPromise
        // Wallet init is best-effort — don't lose tap result if it fails
        try {
          await walletPromise
        } catch (e) {
          console.warn('Wallet init failed, will retry:', e)
        }

        await handleTapResult(tapResult, cachedAddr)
      } else {
        // First-time user OR no tap — must init wallet to get address
        const addr = await initWallet()

        if (tapParams) {
          const tapResult = await submitTap(addr, tapParams.venueId, tapParams.tagId)
          await handleTapResult(tapResult, addr)
        } else {
          // Check for in-progress exit on cold start
          const exitState = await AsyncStorage.getItem('unilateral-exit-state')
          if (exitState) {
            const parsed = JSON.parse(exitState)
            if (parsed.vtxoTxids?.length > 0) {
              const balance = await getBalance()
              setState({ kind: 'ready', balance, address: addr })
              setOverlay({ kind: 'exit' })
              return
            }
          }

          const [balance, count] = await Promise.all([getBalance(), fetchTapCount(addr)])
          setTapCount(count)
          setState({ kind: 'ready', balance, address: addr })
        }
      }
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Startup failed',
      })
    } finally {
      SplashScreen.hideAsync()
    }
  }

  async function handleTapResult(tapResult: TapResult, addr: string) {
    if (tapResult.success) {
      const balance = await getBalance()
      if (tapResult.totalTaps != null) setTapCount(tapResult.totalTaps)
      setState({
        kind: 'tapSuccess',
        balance,
        address: addr,
        reward: tapResult.amount || REWARD_SATS,
      })
    } else if (tapResult.retryAfterMs) {
      setState({
        kind: 'rateLimited',
        retryAfterSeconds: Math.ceil(tapResult.retryAfterMs / 1000),
      })
    } else {
      setState({ kind: 'error', message: tapResult.error })
    }
  }

  async function handleTap(venueId: string, tagId: string) {
    const addr = getAddress()
    if (!addr) return
    try {
      const result = await submitTap(addr, venueId, tagId)
      if (result.success) {
        const balance = await getBalance()
        if (result.totalTaps != null) setTapCount(result.totalTaps)
        setState({
          kind: 'tapSuccess',
          balance,
          address: addr,
          reward: result.amount || REWARD_SATS,
        })
      } else if (result.retryAfterMs) {
        setState({
          kind: 'rateLimited',
          retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000),
        })
      } else {
        setState({ kind: 'error', message: result.error })
      }
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Tap failed',
      })
    }
  }

  async function getBalance(): Promise<number> {
    try {
      const w = getWallet()
      const bal = await w.getBalance()
      console.log('[Balance]', JSON.stringify(bal))
      return Number(bal.available)
    } catch {
      return 0
    }
  }

  async function refreshBalance() {
    const addr = getAddress()
    if (!addr) return
    const balance = await getBalance()
    setState({ kind: 'ready', balance, address: addr })
  }

  // --- Render ---

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerScreen}>
          <Text style={styles.brand}>JUKESATS</Text>
          <ActivityIndicator size="large" color="#f7931a" style={{ marginTop: 24 }} />
          <StatusBar style="light" />
        </View>
      </SafeAreaView>
    )
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerScreen}>
          <Text style={styles.brand}>JUKESATS</Text>
          <Text style={styles.errorText}>{state.message}</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            onPress={coldStart}
          >
            <Text style={styles.primaryBtnText}>Retry</Text>
          </Pressable>
          <StatusBar style="light" />
        </View>
      </SafeAreaView>
    )
  }

  if (state.kind === 'rateLimited') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerScreen}>
          <Text style={styles.brand}>JUKESATS</Text>
          <Text style={styles.rateLimitTitle}>Too fast!</Text>
          <Text style={styles.rateLimitSub}>
            Try again in {state.retryAfterSeconds}s
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            onPress={coldStart}
          >
            <Text style={styles.primaryBtnText}>OK</Text>
          </Pressable>
          <StatusBar style="light" />
        </View>
      </SafeAreaView>
    )
  }

  // Ready or TapSuccess
  const balance = state.balance
  const address = state.address
  const isOffline = aspHealth === 'offline'

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        {/* ASP Health Banner */}
        {isOffline && (
          <AspHealthBanner onPress={() => setOverlay({ kind: 'exitInfo' })} />
        )}

        {/* Brand header */}
        <Text style={styles.brand}>JUKESATS</Text>

        {/* Balance hero */}
        <View style={styles.balanceHero}>
          <View style={styles.balanceGlow} />
          <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
          <Pressable onPress={() => setTooltip('sats')} style={styles.unitRow} hitSlop={12}>
            <Text style={styles.balanceUnit}>SATS</Text>
            <MaterialCommunityIcons name="information-outline" size={13} color="#5a5449" />
          </Pressable>
        </View>

        {/* Tap count */}
        {tapCount > 0 && (
          <Text style={styles.tapStat}>{tapCount} tap{tapCount !== 1 ? 's' : ''} earned</Text>
        )}

        {/* Divider */}
        <View style={styles.divider} />

        {/* Spend section */}
        <Text style={styles.sectionLabel}>SPEND</Text>
        <View style={styles.cardRow}>
          <Pressable
            style={({ pressed }) => [styles.featureCard, pressed && styles.cardPressed]}
            onPress={() => setTooltip('jukebox')}
          >
            <MaterialCommunityIcons name="music-note" size={22} color="#f7931a" />
            <Text style={styles.cardTitle}>JukeSats</Text>
            <Text style={styles.cardSub}>Coming soon</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.featureCard, pressed && styles.cardPressed]}
            onPress={() => setTooltip('stack')}
          >
            <MaterialCommunityIcons name="trending-up" size={22} color="#f7931a" />
            <Text style={styles.cardTitle}>Stack</Text>
            <Text style={styles.cardSub}>Save in BTC</Text>
          </Pressable>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Wallet section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>WALLET</Text>
          <Pressable onPress={() => setTooltip('send')} hitSlop={12}>
            <MaterialCommunityIcons name="information-outline" size={13} color="#5a5449" />
          </Pressable>
        </View>

        <View style={styles.walletRows}>
          <Pressable
            style={({ pressed }) => [
              styles.walletRow,
              pressed && !isOffline && styles.walletRowPressed,
              isOffline && styles.walletRowDisabled,
            ]}
            onPress={() => !isOffline && setOverlay({ kind: 'scan' })}
            disabled={isOffline}
          >
            <View style={[styles.walletIcon, isOffline && styles.walletIconDim]}>
              <MaterialCommunityIcons name="arrow-up" size={18} color={isOffline ? '#3a3530' : '#f7931a'} />
            </View>
            <Text style={[styles.walletRowText, isOffline && styles.walletRowTextDim]}>Send</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#2a2825" />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.walletRow,
              pressed && !isOffline && styles.walletRowPressed,
              isOffline && styles.walletRowDisabled,
            ]}
            onPress={() => !isOffline && setOverlay({ kind: 'receive' })}
            disabled={isOffline}
          >
            <View style={[styles.walletIcon, isOffline && styles.walletIconDim]}>
              <MaterialCommunityIcons name="arrow-down" size={18} color={isOffline ? '#3a3530' : '#f7931a'} />
            </View>
            <Text style={[styles.walletRowText, isOffline && styles.walletRowTextDim]}>Receive</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#2a2825" />
          </Pressable>

          {isOffline && (
            <Pressable
              style={({ pressed }) => [styles.exitRow, pressed && styles.exitRowPressed]}
              onPress={() => setOverlay({ kind: 'exit' })}
            >
              <MaterialCommunityIcons name="shield-alert-outline" size={18} color="#f7931a" />
              <Text style={styles.exitRowText}>Emergency Exit</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color="#2a2825" />
            </Pressable>
          )}
        </View>

        {/* Tap success overlay */}
        {state.kind === 'tapSuccess' && (
          <Animated.View style={[styles.tapOverlay, { opacity: fadeAnim }]}>
            <Text style={styles.rewardAmount}>+{state.reward}</Text>
            <Text style={styles.rewardUnit}>SATS</Text>
          </Animated.View>
        )}

        {/* Overlays */}
        {overlay?.kind === 'receive' && (
          <QRReceiveScreen
            address={address}
            onClose={() => setOverlay(null)}
          />
        )}

        {overlay?.kind === 'scan' && (
          <QRSendScreen
            onScanned={(result) => {
              setOverlay({ kind: 'send', address: result.address, amount: result.amount })
            }}
            onClose={() => setOverlay(null)}
          />
        )}

        {overlay?.kind === 'send' && (
          <WithdrawOverlay
            balance={balance}
            initialAddress={overlay.address}
            initialAmount={overlay.amount ?? undefined}
            onClose={() => {
              setOverlay(null)
              refreshBalance()
            }}
          />
        )}

        {overlay?.kind === 'exit' && (
          <UnilateralExitOverlay
            onClose={() => {
              setOverlay(null)
              refreshBalance()
            }}
          />
        )}

        {overlay?.kind === 'exitInfo' && (
          <EducationalOverlay
            title="Your funds are safe."
            content={[
              'The ASP (Ark Service Provider) is currently unreachable. This means you cannot send or receive sats through the normal Ark protocol.',
              'However, your funds are NOT lost. The Ark protocol is designed so you can always recover your bitcoin to the main Bitcoin blockchain — without needing the ASP.',
              'This is called a "unilateral exit." Your wallet holds pre-signed Bitcoin transactions that can be broadcast on-chain at any time.',
              'To exit, you\'ll need a small amount of on-chain BTC for miner fees. The process takes some time due to Bitcoin\'s security timelocks, but your funds are always yours.',
            ]}
            onClose={() => setOverlay(null)}
          />
        )}

        {tooltip && (
          <EducationalOverlay
            title={TOOLTIPS[tooltip].title}
            content={TOOLTIPS[tooltip].content}
            onClose={() => setTooltip(null)}
          />
        )}

        <StatusBar style="light" />
      </View>
    </SafeAreaView>
  )
}

// --- Styles ---

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#050505',
  },

  // Centered screens (loading, error, rate limit)
  centerScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // Main screen
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  // Brand
  brand: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 6,
    color: '#5a5449',
    textAlign: 'center',
    marginBottom: 8,
  },

  // Balance hero
  balanceHero: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  balanceGlow: {
    position: 'absolute',
    width: 260,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(247, 147, 26, 0.04)',
    top: 16,
    // iOS shadow creates a soft amber halo
    shadowColor: '#f7931a',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 40,
  },
  balanceAmount: {
    fontSize: 52,
    fontWeight: '300',
    color: '#f0ece4',
    letterSpacing: -1,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  balanceUnit: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#f7931a',
  },

  // Tap stat
  tapStat: {
    fontSize: 13,
    color: '#5a5449',
    textAlign: 'center',
    marginBottom: 8,
  },

  // Dividers
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2a2825',
    marginVertical: 20,
  },

  // Section labels
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#5a5449',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },

  // Feature cards
  cardRow: {
    flexDirection: 'row',
    gap: 10,
  },
  featureCard: {
    flex: 1,
    backgroundColor: '#111110',
    borderWidth: 1,
    borderColor: '#2a2825',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  cardPressed: {
    backgroundColor: '#1a1918',
    borderColor: '#3a3530',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f0ece4',
    marginTop: 4,
  },
  cardSub: {
    fontSize: 12,
    color: '#5a5449',
  },

  // Wallet rows
  walletRows: {
    gap: 8,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111110',
    borderWidth: 1,
    borderColor: '#2a2825',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  walletRowPressed: {
    backgroundColor: '#1a1918',
    borderColor: '#3a3530',
  },
  walletRowDisabled: {
    opacity: 0.4,
  },
  walletIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletIconDim: {
    backgroundColor: 'rgba(247, 147, 26, 0.03)',
  },
  walletRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#f0ece4',
  },
  walletRowTextDim: {
    color: '#3a3530',
  },

  // Emergency exit row
  exitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.2)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  exitRowPressed: {
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
  },
  exitRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#f7931a',
  },

  // Tap success overlay
  tapOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 5, 5, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardAmount: {
    fontSize: 64,
    fontWeight: '200',
    color: '#f7931a',
    letterSpacing: -2,
  },
  rewardUnit: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#f7931a',
    marginTop: 4,
    opacity: 0.7,
  },

  // Error screen
  errorText: {
    fontSize: 15,
    color: '#ef4444',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 24,
    maxWidth: 280,
    lineHeight: 22,
  },

  // Rate limit screen
  rateLimitTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#f0ece4',
    marginTop: 24,
    marginBottom: 8,
  },
  rateLimitSub: {
    fontSize: 15,
    color: '#5a5449',
    marginBottom: 28,
  },

  // Primary button
  primaryBtn: {
    backgroundColor: '#f7931a',
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 10,
  },
  primaryBtnPressed: {
    backgroundColor: '#d97e16',
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#050505',
  },
})

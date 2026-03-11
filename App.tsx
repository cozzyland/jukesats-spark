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
import { initWallet, getAddress, getBalance, getCachedAddress, onTransferReceived } from './src/wallet'
import { WithdrawOverlay } from './src/WithdrawOverlay'
import { QRReceiveScreen } from './src/QRReceiveScreen'
import { QRSendScreen } from './src/QRSendScreen'
import { EducationalOverlay } from './src/EducationalOverlay'

const API_URL = 'https://jukesats-spark.fly.dev'
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
      "This is a Spark wallet. Your sats are real Bitcoin — not tokens, not IOUs.",
      "Spark transfers are instant and fee-free. You can also send and receive via the Lightning Network.",
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
  userSparkAddress: string,
  venueId: string,
  nfcTagId: string
): Promise<TapResult> {
  const res = await fetch(`${API_URL}/tap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userSparkAddress, venueId, nfcTagId }),
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

async function fetchTapCount(userSparkAddress: string): Promise<number> {
  try {
    const res = await fetch(`${API_URL}/user-stats/${userSparkAddress}`)
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
  >(null)
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

  const [refreshing, setRefreshing] = useState(false)

  async function refreshBalance() {
    const addr = getAddress()
    if (!addr) return
    setRefreshing(true)
    try {
      const balance = await getBalance()
      setState({ kind: 'ready', balance, address: addr })
    } finally {
      setRefreshing(false)
    }
  }

  // Listen for incoming transfers in real-time via Spark SDK events
  useEffect(() => {
    if (state.kind !== 'ready' && state.kind !== 'tapSuccess') return
    const unsub = onTransferReceived((balanceSats) => {
      const addr = getAddress()
      if (addr) setState({ kind: 'ready', balance: balanceSats, address: addr })
    })
    return unsub
  }, [state.kind])

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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        {/* Brand header */}
        <Text style={styles.brand}>JUKESATS</Text>

        {/* Balance hero — tap to refresh */}
        <Pressable onPress={refreshBalance} style={styles.balanceHero}>
          <View style={styles.balanceGlow} />
          <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
          <View style={styles.unitRow}>
            <Pressable onPress={() => setTooltip('sats')} hitSlop={12} style={styles.unitRow}>
              <Text style={styles.balanceUnit}>SATS</Text>
              <MaterialCommunityIcons name="information-outline" size={13} color="#5a5449" />
            </Pressable>
            {refreshing && <ActivityIndicator size="small" color="#f7931a" style={{ marginLeft: 8 }} />}
          </View>
        </Pressable>

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
          <Pressable onPress={() => setTooltip('send')} hitSlop={12} style={styles.sectionInfoBtn}>
            <MaterialCommunityIcons name="information-outline" size={12} color="#3a3530" />
          </Pressable>
        </View>

        <View style={styles.walletGroup}>
          <Pressable
            style={({ pressed }) => [
              styles.walletRow,
              pressed && styles.walletRowPressed,
            ]}
            onPress={() => setOverlay({ kind: 'scan' })}
          >
            <View style={styles.walletIcon}>
              <MaterialCommunityIcons name="arrow-up" size={18} color="#f7931a" />
            </View>
            <Text style={styles.walletRowText}>Send</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#2a2825" />
          </Pressable>

          <View style={styles.walletDivider} />

          <Pressable
            style={({ pressed }) => [
              styles.walletRow,
              pressed && styles.walletRowPressed,
            ]}
            onPress={() => setOverlay({ kind: 'receive' })}
          >
            <View style={styles.walletIcon}>
              <MaterialCommunityIcons name="arrow-down" size={18} color="#f7931a" />
            </View>
            <Text style={styles.walletRowText}>Receive</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#2a2825" />
          </Pressable>
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
            onManualEntry={() => {
              setOverlay({ kind: 'send', address: '', amount: null })
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
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 12,
  },
  sectionInfoBtn: {
    paddingBottom: 1,
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

  // Wallet group (single card container)
  walletGroup: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 12,
  },
  walletRowPressed: {
    backgroundColor: 'rgba(247, 147, 26, 0.04)',
  },
  walletDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#1a1918',
    marginLeft: 52,
  },
  walletIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#f0ece4',
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

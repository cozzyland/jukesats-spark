import { useState, useEffect, useRef } from 'react'
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Pressable,
  Animated,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as SplashScreen from 'expo-splash-screen'
import * as Linking from 'expo-linking'
import { initWallet, getAddress, getWallet, getCachedAddress } from './src/wallet'
import { WithdrawOverlay } from './src/WithdrawOverlay'
import { QRReceiveScreen } from './src/QRReceiveScreen'
import { QRSendScreen } from './src/QRSendScreen'
import { CoffeeIndicator } from './src/CoffeeIndicator'
import { EducationalOverlay } from './src/EducationalOverlay'

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
    // Universal Links (iOS) / App Links (Android): https://cozzyland.net/tap?venue=...
    // Custom scheme fallback (Android + simulator testing): jukesats://tap?venue=...
    // In custom scheme URLs, "tap" becomes the host, not the path
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
      <View style={styles.container}>
        <Text style={styles.headerText}>Tap for Bitcoin(Sats)!</Text>
        <ActivityIndicator size="large" color="#f7931a" style={{ marginTop: 20 }} />
        <StatusBar style="light" />
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.headerText}>Tap for Bitcoin(Sats)!</Text>
        <Text style={styles.errorText}>{state.message}</Text>
        <Pressable style={styles.button} onPress={coldStart}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
        <StatusBar style="light" />
      </View>
    )
  }

  if (state.kind === 'rateLimited') {
    return (
      <View style={styles.container}>
        <Text style={styles.headerText}>Tap for Bitcoin(Sats)!</Text>
        <Text style={styles.subtitle}>Too fast!</Text>
        <Text style={styles.rateLimit}>
          Try again in {state.retryAfterSeconds}s
        </Text>
        <Pressable style={styles.button} onPress={coldStart}>
          <Text style={styles.buttonText}>OK</Text>
        </Pressable>
        <StatusBar style="light" />
      </View>
    )
  }

  // Ready or TapSuccess
  const balance = state.balance
  const address = state.address

  return (
    <View style={styles.container}>
      {/* Header */}
      <Pressable style={styles.headerRow} onPress={() => setTooltip('sats')}>
        <Text style={styles.headerText}>Tap for Bitcoin(Sats)!</Text>
        <MaterialCommunityIcons name="information-outline" size={20} color="#f7931a" />
      </Pressable>

      <CoffeeIndicator
        balance={balance}
        onBuyCoffee={() => setOverlay({ kind: 'scan' })}
      />

      {/* Balance */}
      <View style={styles.balanceContainer}>
        <Text style={styles.balanceValue}>
          {balance.toLocaleString()} sats
        </Text>
      </View>

      {/* Use your bitcoin */}
      <Text style={styles.sectionLabel}>Use your bitcoin</Text>
      <View style={styles.actionRow}>
        <Pressable
          style={styles.orangeButton}
          onPress={() => setTooltip('jukebox')}
        >
          <MaterialCommunityIcons name="music-note" size={18} color="#000" />
          <Text style={styles.orangeButtonText}>JukeSats</Text>
        </Pressable>
        <Pressable
          style={styles.orangeButton}
          onPress={() => setTooltip('stack')}
        >
          <MaterialCommunityIcons name="piggy-bank" size={18} color="#000" />
          <Text style={styles.orangeButtonText}>Stack / Save</Text>
        </Pressable>
      </View>

      <Text style={styles.orText}>or</Text>

      {/* Send & Receive Bitcoin */}
      <Pressable style={styles.sectionRow} onPress={() => setTooltip('send')}>
        <Text style={styles.sectionLabel}>Send & Receive Bitcoin</Text>
        <MaterialCommunityIcons name="information-outline" size={16} color="#888" />
      </Pressable>
      <View style={styles.columnButtons}>
        <Pressable
          style={styles.orangeButton}
          onPress={() => setOverlay({ kind: 'scan' })}
        >
          <MaterialCommunityIcons name="send" size={18} color="#000" />
          <Text style={styles.orangeButtonText}>Send</Text>
        </Pressable>
        <Pressable
          style={styles.orangeButton}
          onPress={() => setOverlay({ kind: 'receive' })}
        >
          <MaterialCommunityIcons name="qrcode" size={18} color="#000" />
          <Text style={styles.orangeButtonText}>Receive</Text>
        </Pressable>
      </View>

      {state.kind === 'tapSuccess' && (
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Text style={styles.rewardText}>
            +{state.reward} sats!
          </Text>
        </Animated.View>
      )}

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

      {tooltip && (
        <EducationalOverlay
          title={TOOLTIPS[tooltip].title}
          content={TOOLTIPS[tooltip].content}
          onClose={() => setTooltip(null)}
        />
      )}

      <StatusBar style="light" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  balanceContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  balanceValue: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  orangeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f7931a',
    paddingVertical: 14,
    borderRadius: 8,
  },
  orangeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  columnButtons: {
    width: '100%',
    gap: 12,
  },
  orText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '600',
    marginVertical: 12,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardText: {
    fontSize: 56,
    fontWeight: '900',
    color: '#f7931a',
  },
  errorText: {
    fontSize: 16,
    color: '#ff4444',
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 300,
  },
  subtitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 10,
  },
  rateLimit: {
    fontSize: 18,
    color: '#888',
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#f7931a',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
})

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
import * as SplashScreen from 'expo-splash-screen'
import * as Linking from 'expo-linking'
import { initWallet, getAddress, getWallet, getCachedAddress } from './src/wallet'
import { WithdrawOverlay } from './src/WithdrawOverlay'
import { QRReceiveScreen } from './src/QRReceiveScreen'
import { QRSendScreen } from './src/QRSendScreen'

const API_URL = 'https://jukesats-server.fly.dev'
const REWARD_SATS = 330

SplashScreen.preventAutoHideAsync()

// --- Types ---

type AppState =
  | { kind: 'loading' }
  | { kind: 'ready'; balance: number; address: string }
  | { kind: 'tapSuccess'; balance: number; address: string; reward: number }
  | { kind: 'rateLimited'; retryAfterSeconds: number }
  | { kind: 'error'; message: string }

type TapResult =
  | { success: true; txid: string; amount: number }
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
          const balance = await getBalance()
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
        <Text style={styles.logo}>Jukesats</Text>
        <ActivityIndicator size="large" color="#f7931a" style={{ marginTop: 20 }} />
        <StatusBar style="light" />
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>Jukesats</Text>
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
        <Text style={styles.logo}>Jukesats</Text>
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
      <Text style={styles.logo}>Jukesats</Text>

      <Pressable style={styles.tapButton}>
        <Text style={styles.tapButtonText}>Tap for Sats</Text>
      </Pressable>

      <View style={styles.balanceContainer}>
        <Text style={styles.balanceLabel}>Balance</Text>
        <Pressable onPress={refreshBalance}>
          <Text style={styles.balanceValue}>
            {balance.toLocaleString()} sats
          </Text>
        </Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={styles.actionButton}
          onPress={() => setOverlay({ kind: 'scan' })}
        >
          <Text style={styles.actionButtonText}>Send</Text>
        </Pressable>
        <Pressable
          style={styles.actionButton}
          onPress={() => setOverlay({ kind: 'receive' })}
        >
          <Text style={styles.actionButtonText}>Receive</Text>
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
  logo: {
    fontSize: 36,
    fontWeight: '800',
    color: '#f7931a',
    marginBottom: 20,
  },
  tapButton: {
    backgroundColor: '#f7931a',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 32,
  },
  tapButtonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#000',
  },
  balanceContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  balanceValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#fff',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#f7931a',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f7931a',
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

import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Share,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  getOnchainAddress,
  getOnchainBalance,
  getExitableVtxos,
  beginUnroll,
  completeExit,
} from './wallet'

const EXIT_STATE_KEY = 'unilateral-exit-state'

type ExitStep =
  | { step: 'info'; vtxoCount: number; totalSats: number; onchainAddress: string }
  | { step: 'fundFees'; onchainAddress: string; onchainBalance: number }
  | { step: 'unrolling'; current: number; total: number; currentTxid: string | null }
  | { step: 'timelockWait'; vtxoTxids: string[]; outputAddress: string }
  | { step: 'claiming'; outputAddress: string }
  | { step: 'success'; txid: string; outputAddress: string }
  | { step: 'error'; message: string; canRetry: boolean }

type PersistedExitState = {
  vtxoTxids: string[]
  outputAddress: string
  startedAt: number
}

type Props = {
  onClose: () => void
}

export function UnilateralExitOverlay({ onClose }: Props) {
  const [current, setCurrent] = useState<ExitStep | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  // Initialize — check for in-progress exit or start fresh
  useEffect(() => {
    init()
  }, [])

  async function init() {
    try {
      // Check for in-progress exit
      const saved = await loadExitState()
      if (saved && saved.vtxoTxids.length > 0) {
        // Resume at timelock wait or claiming
        setCurrent({
          step: 'timelockWait',
          vtxoTxids: saved.vtxoTxids,
          outputAddress: saved.outputAddress,
        })
        return
      }

      // Fresh start — gather info
      const [vtxos, onchainAddress] = await Promise.all([
        getExitableVtxos(),
        getOnchainAddress(),
      ])

      const totalSats = vtxos.reduce((sum, v) => sum + Number(v.value), 0)

      if (!mountedRef.current) return
      setCurrent({
        step: 'info',
        vtxoCount: vtxos.length,
        totalSats,
        onchainAddress,
      })
    } catch (err) {
      if (!mountedRef.current) return
      setCurrent({
        step: 'error',
        message: err instanceof Error ? err.message : 'Failed to initialize',
        canRetry: true,
      })
    }
  }

  async function handleContinueToFund() {
    if (current?.step !== 'info') return
    const balance = await getOnchainBalance()
    if (!mountedRef.current) return
    setCurrent({
      step: 'fundFees',
      onchainAddress: current.onchainAddress,
      onchainBalance: balance,
    })
  }

  async function handleRefreshBalance() {
    if (current?.step !== 'fundFees') return
    const balance = await getOnchainBalance()
    if (!mountedRef.current) return
    setCurrent({ ...current, onchainBalance: balance })
  }

  async function handleStartUnroll() {
    try {
      const vtxos = await getExitableVtxos()
      const onchainAddress = await getOnchainAddress()
      const total = vtxos.length

      if (!mountedRef.current) return
      setCurrent({ step: 'unrolling', current: 0, total, currentTxid: null })

      const completedTxids: string[] = []

      for (let i = 0; i < vtxos.length; i++) {
        const vtxo = vtxos[i]
        try {
          for await (const progress of beginUnroll({ txid: vtxo.txid, vout: vtxo.vout })) {
            if (!mountedRef.current) return
            if (progress.type === 'unroll') {
              setCurrent({ step: 'unrolling', current: i, total, currentTxid: progress.txId })
            } else if (progress.type === 'wait') {
              setCurrent({ step: 'unrolling', current: i, total, currentTxid: progress.txid })
            } else if (progress.type === 'done') {
              completedTxids.push(progress.vtxoTxid)
              await saveExitState({ vtxoTxids: completedTxids, outputAddress: onchainAddress, startedAt: Date.now() })
            }
          }
        } catch (err) {
          console.error(`[Exit] Failed to unroll ${vtxo.txid}:${vtxo.vout}:`, err)
          // Continue with remaining VTXOs
        }
      }

      if (!mountedRef.current) return

      if (completedTxids.length > 0) {
        setCurrent({
          step: 'timelockWait',
          vtxoTxids: completedTxids,
          outputAddress: onchainAddress,
        })
      } else {
        setCurrent({
          step: 'error',
          message: 'Failed to unroll any VTXOs. Your on-chain wallet may need more BTC for fees.',
          canRetry: true,
        })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setCurrent({
        step: 'error',
        message: err instanceof Error ? err.message : 'Unroll failed',
        canRetry: true,
      })
    }
  }

  async function handleClaim() {
    if (current?.step !== 'timelockWait') return
    const { vtxoTxids, outputAddress } = current

    setCurrent({ step: 'claiming', outputAddress })

    try {
      const txid = await completeExit(vtxoTxids, outputAddress)
      await clearExitState()
      if (!mountedRef.current) return
      setCurrent({ step: 'success', txid, outputAddress })
    } catch (err) {
      if (!mountedRef.current) return
      const message = err instanceof Error ? err.message : 'Claim failed'
      // If it mentions timelock, the user needs to wait longer
      const isTimelockError = message.toLowerCase().includes('timelock') || message.toLowerCase().includes('csv')
      setCurrent({
        step: 'error',
        message: isTimelockError
          ? 'Timelock has not expired yet. Please wait and try again later.'
          : message,
        canRetry: true,
      })
    }
  }

  async function handleRetry() {
    init()
  }

  function handleShareAddress(addr: string) {
    Share.share({ message: addr })
  }

  // --- Render ---

  if (!current) {
    return (
      <View style={styles.overlay}>
        <ActivityIndicator size="large" color="#f7931a" />
      </View>
    )
  }

  return (
    <View style={styles.overlay}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {current.step === 'info' && (
          <>
            <Text style={styles.title}>Emergency Exit</Text>
            <Text style={styles.subtitle}>Your ASP is offline. Your bitcoin is safe.</Text>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>VTXOs to unroll</Text>
              <Text style={styles.infoValue}>{current.vtxoCount}</Text>
            </View>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Total balance</Text>
              <Text style={styles.infoValue}>{current.totalSats.toLocaleString()} sats</Text>
            </View>

            <Text style={styles.warningText}>
              Unilateral exit broadcasts your VTXOs to the Bitcoin blockchain. You'll need a
              small amount of on-chain BTC for miner fees.
            </Text>

            {current.vtxoCount === 0 ? (
              <Text style={styles.emptyText}>No VTXOs to unroll. Your balance may already be on-chain.</Text>
            ) : (
              <View style={styles.buttonRow}>
                <Pressable style={styles.cancelButton} onPress={onClose}>
                  <Text style={styles.cancelButtonText}>Not now</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={handleContinueToFund}>
                  <Text style={styles.primaryButtonText}>Continue</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {current.step === 'fundFees' && (
          <>
            <Text style={styles.title}>Fund Miner Fees</Text>
            <Text style={styles.subtitle}>
              Send a small amount of BTC to this address for miner fees.
            </Text>

            <View style={styles.qrContainer}>
              <QRCode value={current.onchainAddress} size={200} backgroundColor="#fff" />
            </View>

            <Pressable onPress={() => handleShareAddress(current.onchainAddress)}>
              <Text style={styles.addressText} selectable numberOfLines={2}>
                {current.onchainAddress}
              </Text>
              <Text style={styles.shareHint}>Tap to share</Text>
            </Pressable>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>On-chain balance</Text>
              <Text style={styles.infoValue}>{current.onchainBalance.toLocaleString()} sats</Text>
            </View>

            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={handleRefreshBalance}>
                <Text style={styles.cancelButtonText}>Refresh</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, current.onchainBalance === 0 && styles.disabledPrimary]}
                onPress={current.onchainBalance > 0 ? handleStartUnroll : undefined}
                disabled={current.onchainBalance === 0}
              >
                <Text style={styles.primaryButtonText}>
                  {current.onchainBalance > 0 ? 'Start Unroll' : 'Waiting for funds...'}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {current.step === 'unrolling' && (
          <>
            <Text style={styles.title}>Unrolling VTXOs</Text>
            <ActivityIndicator size="large" color="#f7931a" style={{ marginVertical: 20 }} />
            <Text style={styles.progressText}>
              VTXO {current.current + 1} of {current.total}
            </Text>
            {current.currentTxid && (
              <Text style={styles.txidSmall} numberOfLines={1} ellipsizeMode="middle">
                {current.currentTxid}
              </Text>
            )}
            <Text style={styles.hintText}>
              Broadcasting transactions to the Bitcoin blockchain...
            </Text>
          </>
        )}

        {current.step === 'timelockWait' && (
          <>
            <Text style={styles.title}>Waiting for Timelock</Text>
            <Text style={styles.subtitle}>
              {current.vtxoTxids.length} VTXO{current.vtxoTxids.length > 1 ? 's' : ''} unrolled successfully.
            </Text>
            <Text style={styles.warningText}>
              Bitcoin's security timelock must expire before you can claim your funds.
              You can close this screen and come back later.
            </Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Close</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleClaim}>
                <Text style={styles.primaryButtonText}>Try Claim</Text>
              </Pressable>
            </View>
          </>
        )}

        {current.step === 'claiming' && (
          <>
            <Text style={styles.title}>Claiming Funds</Text>
            <ActivityIndicator size="large" color="#f7931a" style={{ marginVertical: 20 }} />
            <Text style={styles.hintText}>
              Broadcasting claim transaction to the Bitcoin blockchain...
            </Text>
          </>
        )}

        {current.step === 'success' && (
          <>
            <Text style={styles.successTitle}>Recovered!</Text>
            <Text style={styles.subtitle}>
              Your bitcoin has been sent to your on-chain address.
            </Text>
            <Text style={styles.txidLabel}>Transaction</Text>
            <Text style={styles.txid} selectable numberOfLines={1} ellipsizeMode="middle">
              {current.txid}
            </Text>
            <Pressable style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </Pressable>
          </>
        )}

        {current.step === 'error' && (
          <>
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorMessage}>{current.message}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Close</Text>
              </Pressable>
              {current.canRetry && (
                <Pressable style={styles.primaryButton} onPress={handleRetry}>
                  <Text style={styles.primaryButtonText}>Retry</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

// --- Persistence ---

async function loadExitState(): Promise<PersistedExitState | null> {
  try {
    const raw = await AsyncStorage.getItem(EXIT_STATE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedExitState
  } catch {
    return null
  }
}

async function saveExitState(state: PersistedExitState): Promise<void> {
  await AsyncStorage.setItem(EXIT_STATE_KEY, JSON.stringify(state))
}

async function clearExitState(): Promise<void> {
  await AsyncStorage.removeItem(EXIT_STATE_KEY)
}

// --- Styles ---

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    paddingVertical: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 16,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: '#888',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  warningText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginVertical: 16,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 20,
  },
  qrContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginVertical: 16,
  },
  addressText: {
    fontSize: 13,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  shareHint: {
    fontSize: 12,
    color: '#f7931a',
    textAlign: 'center',
    marginBottom: 16,
  },
  progressText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  txidSmall: {
    fontSize: 12,
    color: '#666',
    maxWidth: 280,
    marginBottom: 16,
  },
  hintText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#444',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
  },
  primaryButton: {
    backgroundColor: '#f7931a',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  disabledPrimary: {
    backgroundColor: '#333',
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#4ade80',
    marginBottom: 16,
  },
  txidLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 16,
    marginBottom: 4,
  },
  txid: {
    fontSize: 13,
    color: '#888',
    maxWidth: 280,
    marginBottom: 24,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ff4444',
    marginBottom: 16,
  },
  errorMessage: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 8,
    maxWidth: 300,
    lineHeight: 22,
  },
})

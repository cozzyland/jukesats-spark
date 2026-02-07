import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { ArkAddress } from '@arkade-os/sdk'
import { sendBitcoin } from './wallet'

// --- State Machine ---

type WithdrawStep =
  | { step: 'form' }
  | { step: 'confirm'; address: string; amount: number }
  | { step: 'sending'; address: string; amount: number }
  | { step: 'success'; address: string; amount: number; txid: string }
  | { step: 'error'; message: string }

type Props = {
  balance: number
  onClose: () => void
  initialAddress?: string
  initialAmount?: number
}

// --- Validation ---

function validateAddress(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return 'Address is required'
  try {
    ArkAddress.decode(trimmed)
    return null
  } catch {
    return 'Invalid ARK address'
  }
}

function validateAmount(input: string, balance: number): string | null {
  const trimmed = input.trim()
  if (!trimmed) return 'Amount is required'
  if (!/^\d+$/.test(trimmed)) return 'Must be a whole number of sats'
  const amount = parseInt(trimmed, 10)
  if (amount <= 0) return 'Must be greater than 0'
  if (amount > balance) return `Exceeds balance (${balance.toLocaleString()} sats available)`
  return null
}

// --- Component ---

export function WithdrawOverlay({ balance, onClose, initialAddress, initialAmount }: Props) {
  const prefilled = !!(initialAddress && initialAmount)
  const [current, setCurrent] = useState<WithdrawStep>(
    prefilled
      ? { step: 'confirm', address: initialAddress, amount: initialAmount }
      : { step: 'form' }
  )
  const [addressInput, setAddressInput] = useState(initialAddress ?? '')
  const [amountInput, setAmountInput] = useState(initialAmount ? String(initialAmount) : '')
  const [validationError, setValidationError] = useState('')
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  function handleContinue() {
    const addrErr = validateAddress(addressInput)
    if (addrErr) {
      setValidationError(addrErr)
      return
    }
    const amtErr = validateAmount(amountInput, balance)
    if (amtErr) {
      setValidationError(amtErr)
      return
    }
    setValidationError('')
    setCurrent({
      step: 'confirm',
      address: addressInput.trim(),
      amount: parseInt(amountInput, 10),
    })
  }

  function handleMax() {
    setAmountInput(String(balance))
    setValidationError('')
  }

  async function handleSend() {
    if (current.step !== 'confirm') return
    const { address, amount } = current

    setCurrent({ step: 'sending', address, amount })
    try {
      const txid = await sendBitcoin(address, amount)
      if (!mountedRef.current) return
      setCurrent({ step: 'success', address, amount, txid })
    } catch (error) {
      if (!mountedRef.current) return
      setCurrent({
        step: 'error',
        message: error instanceof Error ? error.message : 'Send failed',
      })
    }
  }

  function handleRetry() {
    if (current.step !== 'error') return
    // Go back to form, keeping inputs
    setCurrent({ step: 'form' })
  }

  function handleBack() {
    if (current.step === 'confirm') {
      setCurrent({ step: 'form' })
    }
  }

  // --- Render ---

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        {current.step === 'form' && (
          <>
            <Text style={styles.title}>Send</Text>

            <Text style={styles.label}>Recipient ARK address</Text>
            <TextInput
              style={styles.input}
              value={addressInput}
              onChangeText={(text) => { setAddressInput(text); setValidationError('') }}
              placeholder="tark1... or ark1..."
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Text style={styles.label}>Amount (sats)</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.input, styles.amountInput]}
                value={amountInput}
                onChangeText={(text) => { setAmountInput(text); setValidationError('') }}
                placeholder="0"
                placeholderTextColor="#555"
                keyboardType="number-pad"
                returnKeyType="done"
              />
              <Pressable style={styles.maxButton} onPress={handleMax}>
                <Text style={styles.maxButtonText}>Max</Text>
              </Pressable>
            </View>

            <Text style={styles.availableText}>
              Available: {balance.toLocaleString()} sats
            </Text>

            {validationError ? (
              <Text style={styles.errorText}>{validationError}</Text>
            ) : null}

            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleContinue}>
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>
            </View>
          </>
        )}

        {current.step === 'confirm' && (
          <>
            <Text style={styles.title}>Confirm Send</Text>
            <Text style={styles.amountDisplay}>
              {current.amount.toLocaleString()} sats
            </Text>
            <Text style={styles.toLabel}>to</Text>
            <Text style={styles.fullAddress} selectable>
              {current.address}
            </Text>

            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={handleBack}>
                <Text style={styles.cancelButtonText}>Back</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleSend}>
                <Text style={styles.primaryButtonText}>Send</Text>
              </Pressable>
            </View>
          </>
        )}

        {current.step === 'sending' && (
          <>
            <Text style={styles.title}>Sending...</Text>
            <ActivityIndicator size="large" color="#f7931a" style={{ marginTop: 20 }} />
            <Text style={styles.sendingHint}>
              This may take a few seconds
            </Text>
          </>
        )}

        {current.step === 'success' && (
          <>
            <Text style={styles.successTitle}>Sent!</Text>
            <Text style={styles.amountDisplay}>
              {current.amount.toLocaleString()} sats
            </Text>
            <Text style={styles.txidLabel}>TX</Text>
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
            <Text style={styles.errorTitle}>Send Failed</Text>
            <Text style={styles.errorMessage}>{current.message}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={handleRetry}>
                <Text style={styles.cancelButtonText}>Retry</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  )
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
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    color: '#888',
    alignSelf: 'stretch',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    color: '#fff',
    fontSize: 16,
    padding: 14,
    width: '100%',
    marginBottom: 16,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    gap: 8,
  },
  amountInput: {
    flex: 1,
  },
  maxButton: {
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 16,
  },
  maxButtonText: {
    color: '#f7931a',
    fontSize: 14,
    fontWeight: '600',
  },
  availableText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#ff4444',
    textAlign: 'center',
    marginBottom: 8,
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
  amountDisplay: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  toLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 12,
  },
  fullAddress: {
    fontSize: 13,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  sendingHint: {
    fontSize: 14,
    color: '#666',
    marginTop: 16,
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
  },
})

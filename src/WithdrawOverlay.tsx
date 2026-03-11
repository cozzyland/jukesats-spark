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
import { sendBitcoin, payLightningInvoice } from './wallet'

// --- State Machine ---

type SendTarget =
  | { kind: 'spark'; address: string }
  | { kind: 'invoice'; invoice: string; amountFromInvoice: boolean }

type WithdrawStep =
  | { step: 'form' }
  | { step: 'confirm'; target: SendTarget; amount: number }
  | { step: 'sending'; target: SendTarget; amount: number }
  | { step: 'success'; target: SendTarget; amount: number; txid: string }
  | { step: 'error'; message: string }

type Props = {
  balance: number
  onClose: () => void
  initialAddress?: string
  initialAmount?: number
}

// --- Helpers ---

function isLightningInvoice(s: string): boolean {
  const lower = s.toLowerCase()
  return lower.startsWith('lnbc') || lower.startsWith('lightning:')
}

function stripLightningPrefix(s: string): string {
  const trimmed = s.trim()
  if (trimmed.toLowerCase().startsWith('lightning:')) return trimmed.slice(10)
  return trimmed
}

/** Decode sats amount from a BOLT11 invoice. Returns null for zero-amount invoices. */
function decodeBolt11Amount(s: string): number | null {
  const invoice = stripLightningPrefix(s).toLowerCase()
  // HRP is everything before the last "1" separator
  const lastOne = invoice.lastIndexOf('1')
  if (lastOne === -1) return null
  const hrp = invoice.slice(0, lastOne)

  // Strip network prefix (lnbc, lntb, lnbcrt)
  let rest = ''
  if (hrp.startsWith('lnbcrt')) rest = hrp.slice(6)
  else if (hrp.startsWith('lnbc')) rest = hrp.slice(4)
  else if (hrp.startsWith('lntb')) rest = hrp.slice(4)
  else return null

  if (!rest) return null // zero-amount invoice

  // Parse amount + optional multiplier (m, u, n, p)
  const match = rest.match(/^(\d+)([munp])?$/)
  if (!match) return null

  const num = parseInt(match[1], 10)
  const multiplier = match[2]

  // Convert to sats (1 BTC = 100,000,000 sats)
  const btcMultipliers: Record<string, number> = {
    m: 100_000,       // milli-BTC → sats
    u: 100,            // micro-BTC → sats
    n: 0.1,            // nano-BTC → sats
    p: 0.0001,         // pico-BTC → sats
  }

  if (multiplier) {
    const sats = num * btcMultipliers[multiplier]
    return Math.round(sats)
  }

  // No multiplier = amount in BTC
  return num * 100_000_000
}

function isZeroAmountInvoice(s: string): boolean {
  return isLightningInvoice(s) && decodeBolt11Amount(s) === null
}

function isSparkAddress(s: string): boolean {
  return /^spark1p[a-z0-9]{20,200}$/.test(s)
}

// --- Validation ---

function validateDestination(input: string): { error: string | null; target: SendTarget | null } {
  const trimmed = input.trim()
  if (!trimmed) return { error: 'Address or invoice is required', target: null }

  if (isLightningInvoice(trimmed)) {
    const invoice = stripLightningPrefix(trimmed)
    return { error: null, target: { kind: 'invoice', invoice, amountFromInvoice: false } }
  }

  if (isSparkAddress(trimmed)) {
    return { error: null, target: { kind: 'spark', address: trimmed } }
  }

  return { error: 'Enter a Lightning invoice or Spark address', target: null }
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
  const [current, setCurrent] = useState<WithdrawStep>(() => {
    if (prefilled) {
      const target: SendTarget = isSparkAddress(initialAddress)
        ? { kind: 'spark', address: initialAddress }
        : { kind: 'invoice', invoice: stripLightningPrefix(initialAddress), amountFromInvoice: false }
      return { step: 'confirm', target, amount: initialAmount }
    }
    return { step: 'form' }
  })
  const [destinationInput, setDestinationInput] = useState(initialAddress ?? '')
  const [amountInput, setAmountInput] = useState(initialAmount ? String(initialAmount) : '')
  const [validationError, setValidationError] = useState('')
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  // Detect invoice properties from input
  const inputIsInvoice = isLightningInvoice(destinationInput.trim())
  const invoiceAmountSats = inputIsInvoice ? decodeBolt11Amount(destinationInput.trim()) : null
  const invoiceIsZeroAmount = inputIsInvoice && invoiceAmountSats === null

  function handleContinue() {
    const { error, target } = validateDestination(destinationInput)
    if (error || !target) {
      setValidationError(error || 'Invalid input')
      return
    }

    // For invoices with encoded amount, use that amount
    if (target.kind === 'invoice' && invoiceAmountSats != null) {
      if (invoiceAmountSats > balance) {
        setValidationError(`Invoice amount (${invoiceAmountSats.toLocaleString()} sats) exceeds balance`)
        return
      }
      target.amountFromInvoice = true
      setValidationError('')
      setCurrent({ step: 'confirm', target, amount: invoiceAmountSats })
      return
    }

    // Amount required for Spark addresses and zero-amount invoices
    const amtErr = validateAmount(amountInput, balance)
    if (amtErr) {
      setValidationError(amtErr)
      return
    }

    const amount = parseInt(amountInput, 10)
    if (target.kind === 'invoice') {
      target.amountFromInvoice = false
    }

    setValidationError('')
    setCurrent({ step: 'confirm', target, amount })
  }

  function handleMax() {
    setAmountInput(String(balance))
    setValidationError('')
  }

  async function handleSend() {
    if (current.step !== 'confirm') return
    const { target, amount } = current

    setCurrent({ step: 'sending', target, amount })
    try {
      let txid: string
      if (target.kind === 'spark') {
        txid = await sendBitcoin(target.address, amount)
      } else {
        txid = await payLightningInvoice(target.invoice, target.amountFromInvoice ? undefined : amount)
      }
      if (!mountedRef.current) return
      setCurrent({ step: 'success', target, amount, txid })
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

            <Text style={styles.label}>Lightning invoice or Spark address</Text>
            <TextInput
              style={styles.input}
              value={destinationInput}
              onChangeText={(text) => { setDestinationInput(text); setValidationError('') }}
              placeholder="lnbc... or spark1p..."
              placeholderTextColor="#3a3530"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              keyboardAppearance="dark"
              multiline
            />

            {invoiceAmountSats != null ? (
              <>
                <Text style={styles.label}>Amount from invoice</Text>
                <Text style={styles.invoiceAmountDisplay}>
                  {invoiceAmountSats.toLocaleString()} sats
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>Amount (sats)</Text>
                <View style={styles.amountRow}>
                  <TextInput
                    style={[styles.input, styles.amountInput]}
                    value={amountInput}
                    onChangeText={(text) => { setAmountInput(text); setValidationError('') }}
                    placeholder="0"
                    placeholderTextColor="#3a3530"
                    keyboardType="number-pad"
                    returnKeyType="done"
                    keyboardAppearance="dark"
                  />
                  <Pressable
                    style={({ pressed }) => [styles.maxBtn, pressed && styles.maxBtnPressed]}
                    onPress={handleMax}
                  >
                    <Text style={styles.maxBtnText}>Max</Text>
                  </Pressable>
                </View>
              </>
            )}

            <Text style={styles.availableText}>
              Available: {balance.toLocaleString()} sats
            </Text>

            {validationError ? (
              <Text style={styles.errorText}>{validationError}</Text>
            ) : null}

            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                onPress={onClose}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                onPress={handleContinue}
              >
                <Text style={styles.primaryBtnText}>Continue</Text>
              </Pressable>
            </View>
          </>
        )}

        {current.step === 'confirm' && (
          <>
            <Text style={styles.title}>Confirm Send</Text>
            {current.amount > 0 ? (
              <>
                <Text style={styles.amountDisplay}>
                  {current.amount.toLocaleString()}
                </Text>
                <Text style={styles.amountUnit}>SATS</Text>
              </>
            ) : (
              <Text style={styles.invoiceAmountHint}>Amount encoded in invoice</Text>
            )}
            <Text style={styles.toLabel}>
              {current.target.kind === 'invoice' ? 'via Lightning' : 'to'}
            </Text>
            <Text style={styles.fullAddress} selectable numberOfLines={3} ellipsizeMode="middle">
              {current.target.kind === 'spark' ? current.target.address : current.target.invoice}
            </Text>

            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                onPress={handleBack}
              >
                <Text style={styles.secondaryBtnText}>Back</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                onPress={handleSend}
              >
                <Text style={styles.primaryBtnText}>Send</Text>
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
            {current.amount > 0 && (
              <>
                <Text style={styles.amountDisplay}>
                  {current.amount.toLocaleString()}
                </Text>
                <Text style={styles.amountUnit}>SATS</Text>
              </>
            )}
            <Text style={styles.txidLabel}>TRANSACTION</Text>
            <Text style={styles.txid} selectable numberOfLines={1} ellipsizeMode="middle">
              {current.txid}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
              onPress={onClose}
            >
              <Text style={styles.primaryBtnText}>Done</Text>
            </Pressable>
          </>
        )}

        {current.step === 'error' && (
          <>
            <Text style={styles.errorTitle}>Send Failed</Text>
            <Text style={styles.errorMessage}>{current.message}</Text>
            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                onPress={onClose}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                onPress={handleRetry}
              >
                <Text style={styles.secondaryBtnText}>Retry</Text>
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
    backgroundColor: 'rgba(5, 5, 5, 0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#f0ece4',
    marginBottom: 24,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#5a5449',
    alignSelf: 'stretch',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#111110',
    borderWidth: 1,
    borderColor: '#2a2825',
    borderRadius: 10,
    color: '#f0ece4',
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
  maxBtn: {
    backgroundColor: '#111110',
    borderWidth: 1,
    borderColor: '#2a2825',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 16,
  },
  maxBtnPressed: {
    backgroundColor: '#1a1918',
    borderColor: '#3a3530',
  },
  maxBtnText: {
    color: '#f7931a',
    fontSize: 14,
    fontWeight: '600',
  },
  availableText: {
    fontSize: 12,
    color: '#5a5449',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#2a2825',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  secondaryBtnPressed: {
    backgroundColor: '#111110',
    borderColor: '#3a3530',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#5a5449',
  },
  primaryBtn: {
    backgroundColor: '#f7931a',
    paddingHorizontal: 28,
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
  amountDisplay: {
    fontSize: 40,
    fontWeight: '300',
    color: '#f0ece4',
    letterSpacing: -1,
  },
  amountUnit: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#f7931a',
    marginTop: 2,
    marginBottom: 12,
  },
  invoiceAmountDisplay: {
    fontSize: 22,
    fontWeight: '500',
    color: '#f0ece4',
    marginBottom: 16,
  },
  invoiceAmountHint: {
    fontSize: 15,
    color: '#8a8578',
    marginBottom: 8,
  },
  toLabel: {
    fontSize: 14,
    color: '#5a5449',
    marginBottom: 12,
  },
  fullAddress: {
    fontSize: 12,
    color: '#8a8578',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  sendingHint: {
    fontSize: 13,
    color: '#5a5449',
    marginTop: 16,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '600',
    color: '#4ade80',
    marginBottom: 16,
  },
  txidLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#5a5449',
    marginTop: 16,
    marginBottom: 6,
  },
  txid: {
    fontSize: 12,
    color: '#8a8578',
    maxWidth: 280,
    marginBottom: 24,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: 16,
  },
  errorMessage: {
    fontSize: 14,
    color: '#8a8578',
    textAlign: 'center',
    marginBottom: 8,
    maxWidth: 300,
    lineHeight: 22,
  },
})

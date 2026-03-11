import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Keyboard,
  Share,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import QRCode from 'react-native-qrcode-svg'
import { createLightningInvoice } from './wallet'

type Props = {
  address: string
  onClose: () => void
}

export function QRReceiveScreen({ address, onClose }: Props) {
  const [amount, setAmount] = useState('')
  const [invoice, setInvoice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current

  // Generate Lightning invoice when user enters an amount
  useEffect(() => {
    const trimmed = amount.trim()
    const sats = (trimmed && /^\d+$/.test(trimmed)) ? parseInt(trimmed, 10) : 0

    if (sats <= 0) {
      // No amount — show Spark address QR, no invoice needed
      setInvoice(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    createLightningInvoice(sats)
      .then((inv) => {
        if (!cancelled) {
          setInvoice(inv)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to create invoice')
          setInvoice(null)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [amount])

  const qrValue = invoice || address

  async function handleCopy() {
    const text = invoice || address
    if (!text) return
    await Clipboard.setStringAsync(text)
    setCopied(true)
    fadeAnim.setValue(1)
    Animated.sequence([
      Animated.delay(1500),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(() => setCopied(false))
  }

  return (
    <Pressable style={styles.overlay} onPress={Keyboard.dismiss}>
      <View style={styles.content}>
        <Text style={styles.title}>Receive</Text>

        <Pressable onPress={handleCopy}>
          <View style={styles.qrContainer}>
            <QRCode
              value={qrValue}
              size={220}
              backgroundColor="#f0ece4"
              color="#050505"
            />
            {loading && (
              <View style={styles.qrLoadingOverlay}>
                <ActivityIndicator size="small" color="#f7931a" />
              </View>
            )}
          </View>
        </Pressable>

        <Text style={styles.qrHint}>
          {invoice ? 'Press QR code to copy Lightning invoice' : 'Press QR code to copy address'}
        </Text>

        {/* Copied notification */}
        {copied && (
          <Animated.View style={[styles.copiedBadge, { opacity: fadeAnim }]}>
            <Text style={styles.copiedText}>{invoice ? 'Lightning invoice copied' : 'Address copied'}</Text>
          </Animated.View>
        )}

        <Pressable
          style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
          onPress={() => Share.share({ message: invoice || address })}
        >
          <Text style={styles.shareBtnText}>Share Invoice</Text>
        </Pressable>

        <Text style={styles.label}>Request amount (optional)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="Any amount"
          placeholderTextColor="#3a3530"
          keyboardType="number-pad"
          returnKeyType="done"
          keyboardAppearance="dark"
        />

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        <Text style={styles.hint}>
          {amount.trim()
            ? 'Anyone with a Bitcoin wallet can pay this invoice'
            : 'Sender chooses how much to send'}
        </Text>

        <Pressable
          style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
          onPress={onClose}
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

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
  qrContainer: {
    padding: 18,
    backgroundColor: '#f0ece4',
    borderRadius: 16,
    marginBottom: 8,
  },
  qrLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(240, 236, 228, 0.85)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrHint: {
    fontSize: 12,
    color: '#5a5449',
    marginBottom: 8,
  },
  copiedBadge: {
    backgroundColor: '#1a1918',
    borderWidth: 1,
    borderColor: '#f7931a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
  },
  copiedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f7931a',
  },
  shareBtn: {
    borderWidth: 1,
    borderColor: '#2a2825',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 24,
  },
  shareBtnPressed: {
    backgroundColor: '#111110',
    borderColor: '#3a3530',
  },
  shareBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8a8578',
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
  errorText: {
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    color: '#5a5449',
    textAlign: 'center',
    marginBottom: 24,
  },
  closeBtn: {
    borderWidth: 1,
    borderColor: '#2a2825',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  closeBtnPressed: {
    backgroundColor: '#111110',
    borderColor: '#3a3530',
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#5a5449',
  },
})

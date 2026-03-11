import { useState, useRef } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { CameraView, useCameraPermissions } from 'expo-camera'
import type { BarcodeScanningResult } from 'expo-camera'

type ScanResult = {
  address: string
  amount: number | null
}

type Props = {
  onScanned: (result: ScanResult) => void
  onManualEntry: () => void
  onClose: () => void
}

function parseQR(data: string): ScanResult | null {
  const trimmed = data.trim()

  // lightning: URI scheme
  if (trimmed.toLowerCase().startsWith('lightning:')) {
    const invoice = trimmed.slice(10)
    if (looksLikeLightningInvoice(invoice)) {
      return { address: invoice, amount: null }
    }
  }

  // Raw Lightning invoice (lnbc...)
  if (looksLikeLightningInvoice(trimmed)) {
    return { address: trimmed, amount: null }
  }

  // spark: URI scheme
  if (trimmed.startsWith('spark:')) {
    const rest = trimmed.slice(6)
    const qIdx = rest.indexOf('?')

    if (qIdx === -1) {
      const address = rest
      if (!looksLikeSparkAddress(address)) return null
      return { address, amount: null }
    }

    const address = rest.slice(0, qIdx)
    if (!looksLikeSparkAddress(address)) return null

    const params = new URLSearchParams(rest.slice(qIdx + 1))
    const amountStr = params.get('amount')
    const amount = amountStr && /^\d+$/.test(amountStr) ? parseInt(amountStr, 10) : null

    return { address, amount }
  }

  // Raw Spark address
  if (looksLikeSparkAddress(trimmed)) {
    return { address: trimmed, amount: null }
  }

  return null
}

function looksLikeSparkAddress(s: string): boolean {
  return /^spark1p[a-z0-9]{20,200}$/.test(s)
}

function looksLikeLightningInvoice(s: string): boolean {
  return /^lnbc[a-z0-9]{20,}$/i.test(s)
}

export function QRSendScreen({ onScanned, onManualEntry, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const [pasteError, setPasteError] = useState('')
  const scannedRef = useRef(false)

  function handleBarcode(result: BarcodeScanningResult) {
    if (scannedRef.current) return
    const parsed = parseQR(result.data)
    if (!parsed) return
    scannedRef.current = true
    onScanned(parsed)
  }

  async function handlePaste() {
    const text = await Clipboard.getStringAsync()
    if (!text?.trim()) {
      setPasteError('Nothing on clipboard')
      return
    }
    const trimmed = text.trim()

    // Check if it's a Lightning invoice
    const invoiceStr = trimmed.toLowerCase().startsWith('lightning:')
      ? trimmed.slice(10)
      : trimmed

    if (looksLikeLightningInvoice(invoiceStr)) {
      scannedRef.current = true
      // Zero-amount invoice: lnbc + separator "1" + data (no digits between lnbc and 1)
      const isZeroAmount = /^lnbc1[^0-9]/i.test(invoiceStr)
      // Pass to WithdrawOverlay — amount: null means user must enter it
      onScanned({ address: invoiceStr, amount: isZeroAmount ? null : null })
      return
    }

    const parsed = parseQR(trimmed)
    if (parsed) {
      scannedRef.current = true
      onScanned(parsed)
    } else {
      onScanned({ address: trimmed, amount: null })
    }
  }

  // Still loading permission state
  if (!permission) {
    return (
      <View style={styles.overlay}>
        <ActivityIndicator size="large" color="#f7931a" />
      </View>
    )
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Camera Access</Text>
          <Text style={styles.hint}>
            Jukesats needs camera access to scan QR codes
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
              onPress={onClose}
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
              onPress={requestPermission}
            >
              <Text style={styles.primaryBtnText}>Allow</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  // Camera ready
  return (
    <View style={styles.overlay}>
      <Text style={styles.scanTitle}>Scan QR Code</Text>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarcode}
        />
      </View>
      <Text style={styles.hint}>
        Scan a Lightning invoice or Spark QR code
      </Text>

      {pasteError ? <Text style={styles.pasteError}>{pasteError}</Text> : null}

      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          onPress={handlePaste}
        >
          <Text style={styles.actionBtnText}>Paste Lightning Invoice</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          onPress={onManualEntry}
        >
          <Text style={styles.actionBtnText}>Enter Manually</Text>
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
        onPress={onClose}
      >
        <Text style={styles.secondaryBtnText}>Cancel</Text>
      </Pressable>
    </View>
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
  scanTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#f0ece4',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#f0ece4',
    marginBottom: 16,
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2825',
    marginBottom: 20,
  },
  camera: {
    flex: 1,
  },
  hint: {
    fontSize: 13,
    color: '#5a5449',
    textAlign: 'center',
    marginBottom: 16,
  },
  pasteError: {
    fontSize: 13,
    color: '#ef4444',
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: '#f7931a',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionBtnPressed: {
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f7931a',
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
})

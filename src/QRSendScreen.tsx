import { useState, useRef } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import type { BarcodeScanningResult } from 'expo-camera'

type ScanResult = {
  address: string
  amount: number | null
}

type Props = {
  onScanned: (result: ScanResult) => void
  onClose: () => void
}

/**
 * Parse a QR code value into an ARK address + optional amount.
 *
 * Accepted formats:
 *   ark1qq4hfss...              (raw address)
 *   tark1qq4hfss...             (raw testnet address)
 *   ark:ark1qq4hfss...?amount=330
 *   ark:tark1qq4hfss...?amount=330
 */
function parseQR(data: string): ScanResult | null {
  const trimmed = data.trim()

  // ark: URI scheme
  if (trimmed.startsWith('ark:')) {
    const rest = trimmed.slice(4) // remove "ark:"
    const qIdx = rest.indexOf('?')

    if (qIdx === -1) {
      // No query params — just the address
      const address = rest
      if (!looksLikeArkAddress(address)) return null
      return { address, amount: null }
    }

    const address = rest.slice(0, qIdx)
    if (!looksLikeArkAddress(address)) return null

    const params = new URLSearchParams(rest.slice(qIdx + 1))
    const amountStr = params.get('amount')
    const amount = amountStr && /^\d+$/.test(amountStr) ? parseInt(amountStr, 10) : null

    return { address, amount }
  }

  // Raw address (no scheme)
  if (looksLikeArkAddress(trimmed)) {
    return { address: trimmed, amount: null }
  }

  return null
}

function looksLikeArkAddress(s: string): boolean {
  return /^(t?ark1)[a-z0-9]{20,200}$/.test(s)
}

export function QRSendScreen({ onScanned, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const scannedRef = useRef(false)

  function handleBarcode(result: BarcodeScanningResult) {
    if (scannedRef.current) return
    const parsed = parseQR(result.data)
    if (!parsed) return
    scannedRef.current = true
    onScanned(parsed)
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
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonText}>Allow</Text>
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
        Point at a Jukesats receive QR code
      </Text>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancel</Text>
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
  scanTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
  },
  camera: {
    flex: 1,
  },
  hint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
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
})

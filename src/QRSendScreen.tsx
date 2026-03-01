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

function parseQR(data: string): ScanResult | null {
  const trimmed = data.trim()

  // ark: URI scheme
  if (trimmed.startsWith('ark:')) {
    const rest = trimmed.slice(4)
    const qIdx = rest.indexOf('?')

    if (qIdx === -1) {
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
        Point at a Jukesats receive QR code
      </Text>
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
    marginBottom: 24,
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

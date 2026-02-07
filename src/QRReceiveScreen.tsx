import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Keyboard,
  Share,
  StyleSheet,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'

type Props = {
  address: string
  onClose: () => void
}

function buildQRValue(address: string, amount: string): string {
  const trimmed = amount.trim()
  if (trimmed && /^\d+$/.test(trimmed) && parseInt(trimmed, 10) > 0) {
    return `ark:${address}?amount=${trimmed}`
  }
  return address
}

export function QRReceiveScreen({ address, onClose }: Props) {
  const [amount, setAmount] = useState('')

  const qrValue = buildQRValue(address, amount)

  return (
    <Pressable style={styles.overlay} onPress={Keyboard.dismiss}>
      <View style={styles.content}>
        <Text style={styles.title}>Receive</Text>

        <View style={styles.qrContainer}>
          <QRCode
            value={qrValue}
            size={220}
            backgroundColor="#fff"
            color="#000"
          />
        </View>

        <Pressable
          style={styles.copyButton}
          onPress={() => Share.share({ message: address })}
        >
          <Text style={styles.copyButtonText}>Copy ARK Address</Text>
        </Pressable>

        <Text style={styles.label}>Request amount (optional)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="sats"
          placeholderTextColor="#555"
          keyboardType="number-pad"
          returnKeyType="done"
          keyboardAppearance="light"
        />

        <Text style={styles.hint}>
          Show this QR code to another Jukesats user
        </Text>

        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
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
  qrContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
  },
  copyButton: {
    borderWidth: 1,
    borderColor: '#444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 20,
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
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
  hint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  closeButton: {
    borderWidth: 1,
    borderColor: '#444',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
  },
})

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
            backgroundColor="#f0ece4"
            color="#050505"
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
          onPress={() => Share.share({ message: address })}
        >
          <Text style={styles.shareBtnText}>Share ARK Address</Text>
        </Pressable>

        <Text style={styles.label}>Request amount (optional)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="sats"
          placeholderTextColor="#3a3530"
          keyboardType="number-pad"
          returnKeyType="done"
          keyboardAppearance="dark"
        />

        <Text style={styles.hint}>
          Show this QR code to another Jukesats user
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
    marginBottom: 16,
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

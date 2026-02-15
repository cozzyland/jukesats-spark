import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

interface StampCardProps {
  tapCount: number
}

const TOTAL_STAMPS = 10

export function StampCard({ tapCount }: StampCardProps) {
  const filled = tapCount % TOTAL_STAMPS
  const isComplete = tapCount > 0 && filled === 0
  const prevCountRef = useRef(tapCount)
  const bounceAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (tapCount > prevCountRef.current) {
      // New tap — bounce the latest stamp
      bounceAnim.setValue(0)
      Animated.spring(bounceAnim, {
        toValue: 1,
        friction: 4,
        tension: 200,
        useNativeDriver: true,
      }).start()
    }
    prevCountRef.current = tapCount
  }, [tapCount])

  const stamps = []
  for (let i = 0; i < TOTAL_STAMPS; i++) {
    const isFilled = isComplete || i < filled
    const isLatest = !isComplete && isFilled && i === filled - 1 && tapCount > 0

    stamps.push(
      <Animated.View
        key={i}
        style={[
          styles.stamp,
          isFilled ? styles.stampFilled : styles.stampEmpty,
          isLatest && { transform: [{ scale: bounceAnim }] },
        ]}
      >
        {isFilled && (
          <MaterialCommunityIcons name="boombox" size={22} color="#fff" />
        )}
      </Animated.View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>COFFEE CARD</Text>
      <View style={styles.grid}>
        <View style={styles.row}>{stamps.slice(0, 5)}</View>
        <View style={styles.row}>{stamps.slice(5, 10)}</View>
      </View>
      <Text style={[styles.counter, isComplete && styles.counterComplete]}>
        {isComplete ? 'Coffee earned!' : `${filled}/${TOTAL_STAMPS} visits`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
    maxWidth: 320,
  },
  label: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 12,
  },
  grid: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  stamp: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampEmpty: {
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  stampFilled: {
    backgroundColor: '#f7931a',
  },
  counter: {
    fontSize: 14,
    color: '#888',
    marginTop: 12,
  },
  counterComplete: {
    color: '#f7931a',
    fontWeight: '700',
  },
})

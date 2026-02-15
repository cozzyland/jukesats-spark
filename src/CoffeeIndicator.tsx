import { View, Text, StyleSheet, Pressable } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

export const COFFEE_PRICE_SATS = 3300

interface CoffeeIndicatorProps {
  balance: number
  onBuyCoffee: () => void
}

export function CoffeeIndicator({ balance, onBuyCoffee }: CoffeeIndicatorProps) {
  const coffeeCount = Math.floor(balance / COFFEE_PRICE_SATS)
  const canAfford = coffeeCount >= 1

  return (
    <Pressable
      style={[styles.container, canAfford && styles.containerActive]}
      onPress={canAfford ? onBuyCoffee : undefined}
      disabled={!canAfford}
    >
      <MaterialCommunityIcons
        name="coffee"
        size={32}
        color={canAfford ? '#f7931a' : '#333'}
      />
      {coffeeCount >= 2 && (
        <Text style={styles.multiplier}>x{coffeeCount}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 20,
  },
  containerActive: {
    borderColor: '#f7931a',
  },
  multiplier: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f7931a',
    marginTop: -2,
  },
})

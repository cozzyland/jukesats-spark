import { View, Text, StyleSheet, Pressable } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

export const COFFEE_PRICE_SATS = 3300

interface CoffeeIndicatorProps {
  balance: number
  onBuyCoffee: () => void
  onInfo: () => void
}

export function CoffeeIndicator({ balance, onBuyCoffee, onInfo }: CoffeeIndicatorProps) {
  if (balance < COFFEE_PRICE_SATS) return null

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="coffee" size={20} color="#f7931a" />
        <Text style={styles.text}>You have enough for a coffee!</Text>
        <Pressable onPress={onInfo} hitSlop={8}>
          <MaterialCommunityIcons name="help-circle-outline" size={18} color="#666" />
        </Pressable>
      </View>
      <Pressable style={styles.button} onPress={onBuyCoffee}>
        <Text style={styles.buttonText}>Buy Coffee</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 14,
    color: '#f7931a',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#f7931a',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
})

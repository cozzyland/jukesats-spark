import { Pressable, Text, View, StyleSheet } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

type Props = {
  onPress: () => void
}

export function AspHealthBanner({ onPress }: Props) {
  return (
    <Pressable style={styles.banner} onPress={onPress}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#f7931a" />
        <Text style={styles.text}>ASP unavailable — your funds are safe</Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color="#888" />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#f7931a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: '100%',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#f7931a',
  },
})

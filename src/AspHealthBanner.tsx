import { Pressable, Text, View, StyleSheet } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

type Props = {
  onPress: () => void
}

export function AspHealthBanner({ onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
      onPress={onPress}
    >
      <View style={styles.row}>
        <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#f7931a" />
        <Text style={styles.text}>ASP unavailable — your funds are safe</Text>
        <MaterialCommunityIcons name="chevron-right" size={16} color="#5a5449" />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(247, 147, 26, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.2)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: '100%',
    marginBottom: 12,
  },
  bannerPressed: {
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#f7931a',
  },
})

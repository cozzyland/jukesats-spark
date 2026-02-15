import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

interface EducationalOverlayProps {
  title: string
  content: string[]
  onClose: () => void
}

export function EducationalOverlay({ title, content, onClose }: EducationalOverlayProps) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={24} color="#888" />
          </Pressable>
        </View>
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {content.map((paragraph, i) => (
            <Text key={i} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </ScrollView>
        <Pressable style={styles.dismissButton} onPress={onClose}>
          <Text style={styles.dismissText}>Got it</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f7931a',
    flex: 1,
    marginRight: 12,
  },
  body: {
    marginBottom: 20,
  },
  paragraph: {
    fontSize: 15,
    color: '#ccc',
    lineHeight: 22,
    marginBottom: 12,
  },
  dismissButton: {
    backgroundColor: '#f7931a',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
})

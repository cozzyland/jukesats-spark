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
            <MaterialCommunityIcons name="close" size={22} color="#5a5449" />
          </Pressable>
        </View>
        <View style={styles.accent} />
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {content.map((paragraph, i) => (
            <Text key={i} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </ScrollView>
        <Pressable
          style={({ pressed }) => [styles.dismissButton, pressed && styles.dismissPressed]}
          onPress={onClose}
        >
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
    backgroundColor: 'rgba(5, 5, 5, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  card: {
    backgroundColor: '#111110',
    borderWidth: 1,
    borderColor: '#2a2825',
    borderRadius: 18,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#f7931a',
    flex: 1,
    marginRight: 12,
    lineHeight: 26,
  },
  accent: {
    width: 32,
    height: 2,
    backgroundColor: '#f7931a',
    borderRadius: 1,
    marginBottom: 16,
    opacity: 0.4,
  },
  body: {
    marginBottom: 20,
  },
  paragraph: {
    fontSize: 14,
    color: '#b5ad9f',
    lineHeight: 22,
    marginBottom: 14,
  },
  dismissButton: {
    backgroundColor: '#f7931a',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  dismissPressed: {
    backgroundColor: '#d97e16',
  },
  dismissText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#050505',
  },
})

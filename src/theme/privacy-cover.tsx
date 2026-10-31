import { StyleSheet, Text, View } from 'react-native';

import { useAppState } from '@/hooks/use-app-state';
import { useAppTheme } from '@/theme/theme-provider';

// Blank the screen whenever the app isn't in the foreground, in every theme,
// so the app switcher snapshot (and glances during Control Center or an
// incoming call banner) never show chats or codes.
export function PrivacyCover() {
  const { theme } = useAppTheme();
  const appState = useAppState();

  if (appState === 'active') return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.mark, { color: theme.colors.textMuted }]}>Ghost</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  mark: { fontSize: 18, fontWeight: '600' },
});

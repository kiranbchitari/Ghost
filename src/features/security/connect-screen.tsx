import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

// Shown while there is no session: either an anonymous identity is being
// created, or creating one failed.
export function ConnectScreen() {
  const { error, isLoading, retry } = useSession();
  const { theme } = useAppTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Ghost</Text>
      {error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.button} disabled={isLoading} onPress={retry}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={theme.colors.textMuted} />
      )}
    </SafeAreaView>
  );
}

const createStyles = ({ colors, glow }: AppTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 16,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 32,
      fontWeight: '700',
      color: colors.text,
      // Padding gives the glow room: iOS clips text shadows to the Text frame.
      ...(glow && {
        textShadowColor: glow,
        textShadowRadius: 14,
        textShadowOffset: { width: 0, height: 0 },
        padding: 16,
      }),
    },
    error: { textAlign: 'center', color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
    buttonText: { color: colors.onAccent, fontWeight: '600' },
  });

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeOut, withTiming } from 'react-native-reanimated';

import { useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

type Source = 'camera' | 'library';

type Props = { onPick: (source: Source) => void };

const OPTIONS: { source: Source; label: string; icon: ComponentProps<typeof MaterialCommunityIcons>['name']; color: string }[] = [
  { source: 'camera', label: 'Camera', icon: 'camera', color: '#f0306f' },
  { source: 'library', label: 'Gallery', icon: 'image', color: '#a855f7' },
];

// Rises a little from the composer, like WhatsApp's attach card. A short timing
// curve rather than a spring keeps it crisp on slower Android phones.
function riseIn() {
  'worklet';
  const config = { duration: 160, easing: Easing.out(Easing.cubic) };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 16 }, { scale: 0.96 }] },
    animations: {
      opacity: withTiming(1, config),
      transform: [{ translateY: withTiming(0, config) }, { scale: withTiming(1, config) }],
    },
  };
}

// WhatsApp-style attach card: round coloured icons above the composer. Render
// it inside a wrapper around the composer; it positions itself just above it.
export function AttachmentPanel({ onPick }: Props) {
  const styles = useThemedStyles(createStyles);

  return (
    <Animated.View entering={riseIn} exiting={FadeOut.duration(100)} style={styles.card}>
      {OPTIONS.map(({ source, label, icon, color }) => (
        <Pressable
          key={source}
          onPress={() => onPick(source)}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={label}>
          <View style={[styles.circle, { backgroundColor: color }]}>
            <MaterialCommunityIcons name={icon} size={26} color="#ffffff" />
          </View>
          <Text style={styles.label}>{label}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const createStyles = ({ colors, glow }: AppTheme) =>
  StyleSheet.create({
    card: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: '100%',
      marginBottom: 8,
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 20,
      paddingHorizontal: 12,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glow ? colors.codeCardBorder : colors.border,
      shadowColor: glow ?? '#000',
      shadowOpacity: glow ? 0.4 : 0.15,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    option: { width: 80, alignItems: 'center', gap: 8 },
    pressed: { opacity: 0.6 },
    circle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    label: { color: colors.textMuted, fontSize: 13 },
  });

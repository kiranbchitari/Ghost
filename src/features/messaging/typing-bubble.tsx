import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

// Three bouncing dots in the other person's bubble while they type.
export function TypingBubble() {
  const styles = useThemedStyles(createStyles);
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={styles.row}
      accessibilityLabel="Typing"
      accessibilityLiveRegion="polite">
      <View style={styles.bubble}>
        {[0, 1, 2].map((i) => (
          <Dot key={i} delay={i * 160} style={styles.dot} />
        ))}
      </View>
    </Animated.View>
  );
}

function Dot({ delay, style }: { delay: number; style: object }) {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(-4, { duration: 260 }), withTiming(0, { duration: 260 })), -1),
    );
  }, [delay, lift]);
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }],
    opacity: 0.5 + (-lift.value / 4) * 0.5,
  }));
  return <Animated.View style={[style, animated]} />;
}

const createStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 12 },
    bubble: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 14,
      paddingVertical: 13,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.bubbleTheirsBorder,
      backgroundColor: colors.bubbleTheirs,
    },
    dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.metaTheirs },
  });

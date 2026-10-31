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

import { useAppTheme, useThemedStyles } from '@/theme/theme-provider';
import type { AppTheme } from '@/theme/themes';

// Three bouncing dots in the other person's bubble while they type.
export function TypingBubble() {
  const styles = useThemedStyles(createStyles);
  const { theme } = useAppTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={styles.row}
      accessibilityLabel="Typing"
      accessibilityLiveRegion="polite">
      <View style={styles.bubble}>
        {theme.chat?.tails && <View style={styles.tail} />}
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

// Matches the incoming bubble: WhatsApp-style (tail, hairline shadow) when
// the theme has a chat style, otherwise the default shape.
const createStyles = ({ colors, chat }: AppTheme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: chat?.tails ? 16 : 12, marginTop: chat ? 4 : 0 },
    bubble: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 14,
      paddingVertical: 13,
      backgroundColor: colors.bubbleTheirs,
      ...(chat
        ? {
            borderRadius: chat.bubbleRadius,
            borderTopLeftRadius: chat.tails ? 0 : chat.bubbleRadius,
            shadowColor: chat.shadow,
            shadowOpacity: 1,
            shadowRadius: 0.5,
            shadowOffset: { width: 0, height: 1 },
            elevation: 1,
          }
        : {
            borderRadius: 16,
            borderBottomLeftRadius: 4,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.bubbleTheirsBorder,
          }),
    },
    tail: {
      position: 'absolute',
      top: 0,
      left: -8,
      width: 0,
      height: 0,
      borderTopWidth: 13,
      borderTopColor: colors.bubbleTheirs,
      borderLeftWidth: 8,
      borderLeftColor: 'transparent',
    },
    dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.metaTheirs },
  });

import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { makeMutable, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDisguise } from '@/features/disguise/disguise-provider';
import { clearDeviceKeyCache } from '@/services/encryption/device-keys';
import { panicLock } from '@/services/security/panic-lock';
import { useAppTheme } from '@/theme/theme-provider';

const SIZE = 44;
const MARGIN = 8;
// Moving less than this is still a tap or a hold (fingers drift while holding).
const DRAG_SLOP = 12;
// Holding this long closes the app.
const HOLD_MS = 600;
// Starts this far above the bottom safe area: clear of the tab bar and of the
// chat composer even with a reply bar open (a stray tap here hides Ghost).
const START_CLEARANCE = 160;

// Shared by every instance (the root one and the ones inside Modals) so the
// button is in the same place on every screen once the person moves it.
let position: Animated.ValueXY | null = null;
let origin = { x: 0, y: 0 };
// Space between the button and the bottom of the screen, read on the UI thread.
const bottomGap = makeMutable(0);

// Height of a panel a screen shows at the bottom in place of the keyboard (the
// chat's emoji panel). The button rises above it just as it does for the keyboard.
export const panicBottomPanel = makeMutable(0);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// One tap hides Ghost behind the Snake game: keys are wiped from memory and
// every chat screen unmounts, just as when the app is locked. Holding it
// closes the app outright and kills its process. There is deliberately no
// confirmation: in a panic every extra tap counts. Drag it if it covers
// something. Render it at the root, and inside every Modal (Modals draw above
// the root).
export function PanicButton() {
  const { theme } = useAppTheme();
  const { lock } = useDisguise();
  const hideBehindGame = () => {
    clearDeviceKeyCache();
    lock();
  };
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const keyboard = useReanimatedKeyboardAnimation();

  const bounds = useMemo(
    () => ({
      minX: MARGIN,
      maxX: width - SIZE - MARGIN,
      minY: insets.top + MARGIN,
      maxY: height - SIZE - insets.bottom - MARGIN,
    }),
    [width, height, insets.top, insets.bottom],
  );

  // Starts in the bottom-right corner, like WhatsApp's new-chat button.
  if (!position) {
    origin = { x: bounds.maxX, y: height - insets.bottom - START_CLEARANCE - SIZE };
    position = new Animated.ValueXY(origin);
  }
  const current = position;
  // Shared values can't be written while rendering, so record the starting gap
  // once mounted (later moves update it on release).
  useEffect(() => {
    if (bottomGap.value === 0) bottomGap.value = height - origin.y - SIZE;
  }, [height]);

  // While the keyboard (or a panel in its place) is up, keep the same clearance
  // above it as above the screen's bottom edge, so the button stays clear of the
  // composer sitting on top of it. Never pushed past the top of the screen.
  const keyboardLift = useAnimatedStyle(() => {
    const covered = Math.max(-keyboard.height.value, panicBottomPanel.value);
    const lift = covered > 0 ? Math.max(0, covered + START_CLEARANCE - bottomGap.value) : 0;
    const room = height - bottomGap.value - SIZE - bounds.minY;
    return { transform: [{ translateY: -Math.min(lift, Math.max(room, 0)) }] };
  });

  // One responder owns the whole touch and decides what it was: let go
  // quickly = tap, still down after HOLD_MS = hold, moved past DRAG_SLOP =
  // drag (which cancels the hold). A separate Pressable would lose its hold
  // the moment the finger drifted and the drag took over.
  const [isPressed, setIsPressed] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef({ dragging: false, held: false });
  const onTap = useRef(hideBehindGame);
  onTap.current = hideBehindGame;

  const panResponder = useMemo(() => {
    const cancelHold = () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
    const settle = (dx: number, dy: number) => {
      origin = {
        x: clamp(origin.x + dx, bounds.minX, bounds.maxX),
        y: clamp(origin.y + dy, bounds.minY, bounds.maxY),
      };
      bottomGap.value = height - origin.y - SIZE;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        gesture.current = { dragging: false, held: false };
        setIsPressed(true);
        holdTimer.current = setTimeout(() => {
          gesture.current.held = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          panicLock();
        }, HOLD_MS);
      },
      onPanResponderMove: (_, { dx, dy }) => {
        if (!gesture.current.dragging && (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP)) {
          gesture.current.dragging = true;
          cancelHold();
        }
        if (gesture.current.dragging) {
          current.setValue({
            x: clamp(origin.x + dx, bounds.minX, bounds.maxX),
            y: clamp(origin.y + dy, bounds.minY, bounds.maxY),
          });
        }
      },
      onPanResponderRelease: (_, { dx, dy }) => {
        cancelHold();
        setIsPressed(false);
        if (gesture.current.dragging) settle(dx, dy);
        else if (!gesture.current.held) onTap.current();
      },
      onPanResponderTerminate: (_, { dx, dy }) => {
        cancelHold();
        setIsPressed(false);
        if (gesture.current.dragging) settle(dx, dy);
      },
    });
  }, [bounds, current, height]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  return (
    <Reanimated.View style={[styles.layer, keyboardLift]} pointerEvents="box-none">
      <Animated.View style={[styles.holder, { transform: current.getTranslateTransform() }]} {...panResponder.panHandlers}>
        <View
          style={[styles.button, { backgroundColor: theme.colors.danger }, isPressed && styles.pressed]}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Panic lock"
          accessibilityHint="Tap to hide Ghost behind the game. Hold to close the app completely."
          accessibilityActions={[{ name: 'activate' }, { name: 'longpress' }]}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? panicLock() : hideBehindGame())}>
          <Ionicons name="power" size={22} color={theme.colors.onDanger} />
        </View>
      </Animated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, elevation: 999 },
  holder: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  pressed: { opacity: 0.6, transform: [{ scale: 0.92 }] },
});

import {
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
  useScreenshotListener,
} from 'expo-screen-capture';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { showAlert } from '@/components/dialog';

// Blocks screenshots, screen recordings and the Recents / app switcher
// snapshot while mounted (iOS 13+: captures come out blank, plus a blurred
// switcher snapshot; Android: FLAG_SECURE). The disguise gate mounts it
// whenever Ghost could be on screen. iOS still reports that a screenshot was
// attempted, so tell the person it didn't work.
export function ScreenProtection() {
  // usePreventScreenCapture, but its cleanup can't reject unhandled: when Ghost
  // closes, Android may have destroyed the screen before blocking is lifted.
  useEffect(() => {
    preventScreenCaptureAsync('app').catch((e: Error) => console.warn('Blocking screenshots failed:', e.message));
    // iOS takes its app switcher snapshot itself: blur it. (On Android,
    // blocked capture already blanks the Recents thumbnail.)
    if (Platform.OS === 'ios') enableAppSwitcherProtectionAsync(1).catch(() => {});
    return () => {
      allowScreenCaptureAsync('app').catch(() => {});
      if (Platform.OS === 'ios') disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);

  const isShowing = useRef(false);
  const onScreenshot = useCallback(() => {
    if (isShowing.current) return;
    isShowing.current = true;
    showAlert(
      'Screenshots are blocked',
      'Ghost hides chats from screenshots and screen recordings.',
      [{ text: 'OK', onPress: () => (isShowing.current = false) }],
      { icon: 'eye-off-outline' },
    );
  }, []);
  useScreenshotListener(onScreenshot);

  return null;
}

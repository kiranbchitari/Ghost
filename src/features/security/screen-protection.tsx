import { allowScreenCaptureAsync, preventScreenCaptureAsync, useScreenshotListener } from 'expo-screen-capture';
import { useCallback, useEffect, useRef } from 'react';

import { showAlert } from '@/components/dialog';

// Blocks screenshots and screen recordings everywhere in the app (iOS 13+:
// captures come out blank; Android: FLAG_SECURE). iOS still reports that a
// screenshot was attempted, so tell the person it didn't work.
export function ScreenProtection() {
  // usePreventScreenCapture, but its cleanup can't reject unhandled: when Ghost
  // closes, Android may have destroyed the screen before blocking is lifted.
  useEffect(() => {
    preventScreenCaptureAsync('app').catch((e: Error) => console.warn('Blocking screenshots failed:', e.message));
    return () => {
      allowScreenCaptureAsync('app').catch(() => {});
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

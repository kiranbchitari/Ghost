import { usePreventScreenCapture, useScreenshotListener } from 'expo-screen-capture';
import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

// Blocks screenshots and screen recordings everywhere in the app (iOS 13+:
// captures come out blank; Android: FLAG_SECURE). iOS still reports that a
// screenshot was attempted, so tell the person it didn't work.
export function ScreenProtection() {
  usePreventScreenCapture('app');

  const isShowing = useRef(false);
  const onScreenshot = useCallback(() => {
    if (isShowing.current) return;
    isShowing.current = true;
    Alert.alert('Screenshots are blocked', 'Ghost hides chats from screenshots and screen recordings.', [
      { text: 'OK', onPress: () => (isShowing.current = false) },
    ]);
  }, []);
  useScreenshotListener(onScreenshot);

  return null;
}

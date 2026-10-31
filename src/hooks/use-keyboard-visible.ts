import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

// iOS fires "will" events (in sync with the animation); Android only "did".
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

export function useKeyboardVisible() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, () => setIsVisible(true));
    const hide = Keyboard.addListener(HIDE_EVENT, () => setIsVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return isVisible;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { showAlert } from '@/components/dialog';
import { wipeSecretsFromMemory } from '@/features/security/wipe-memory';
import {
  clearMasterKey,
  DEFAULT_MASTER_KEY,
  isUsingDefaultKey,
  setMasterKey,
  verifyMasterKey,
} from '@/services/security/master-key';

// The app is always a Snake game on the outside. Ghost is locked on every
// launch and every time it goes to the background; entering the master key
// under the game's Settings → Redeem code opens it. Before a key is set, the
// starting key "ghost" does.
type DisguiseState = {
  isLocked: boolean;
  // Screen capture must stay blocked: while unlocked, and after locking on the
  // way to the background until the app is opened again. Android snapshots the
  // app for Recents only after it has left the screen, so lifting the block
  // as it locks would let the chat (still drawn) into that snapshot.
  isCaptureBlocked: boolean;
  // Still on the starting key: Ghost nudges the person to choose their own.
  isDefaultKey: boolean;
  // True if the key was right (and Ghost is now unlocked).
  unlock: (key: string) => Promise<boolean>;
  lock: () => void;
  changeKey: (key: string) => Promise<void>;
  // Runs `task` (the camera or photo picker, a permission prompt) without
  // locking when the app goes to the background for it: on Android those are
  // separate screens, so the app counts as left. Locks afterwards if the app
  // isn't back in the foreground by then.
  withoutAutoLock: <T>(task: () => Promise<T>) => Promise<T>;
};

const DisguiseContext = createContext<DisguiseState | null>(null);

// SecureStore (the iOS keychain) outlives an uninstall; AsyncStorage doesn't.
// No marker means a fresh install, so a key left by an earlier install is
// dropped and the starting key works again: reinstalling is the way back in
// after forgetting the master key (the chats are gone by then anyway).
const INSTALL_MARKER = 'ghost.disguise.installed';

async function forgetKeyFromEarlierInstall() {
  let isFreshInstall = false;
  try {
    isFreshInstall = (await AsyncStorage.getItem(INSTALL_MARKER)) === null;
  } catch {
    // Can't tell: keep whatever key there is.
  }
  if (!isFreshInstall) return;
  // Marker first: if it can't be written, every launch would look like a fresh
  // install and wipe the owner's key (letting "ghost" back in). Keep the key then.
  await AsyncStorage.setItem(INSTALL_MARKER, '1');
  await clearMasterKey();
}

export function DisguiseProvider({ children }: PropsWithChildren) {
  // Locked from the very first frame, whatever happens with storage.
  const [isLocked, setIsLocked] = useState(true);
  const [isDefaultKey, setIsDefaultKey] = useState(false);
  const [keepCaptureBlocked, setKeepCaptureBlocked] = useState(false);
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  // Bumped by every lock. An unlock that was still checking the key when the
  // app locked (owner swiped home right after tapping OK) must not open Ghost.
  const lockCount = useRef(0);
  // Pickers running without auto-lock, and whether the app left meanwhile.
  const suspended = useRef(0);
  const leftWhileSuspended = useRef(false);

  const lockNow = useCallback(() => {
    lockCount.current++;
    wipeSecretsFromMemory();
    setIsLocked(true);
  }, []);
  // Unlocking waits for the install check, so a stale key can't be used.
  const startup = useRef<Promise<void> | null>(null);

  const refreshIsDefaultKey = useCallback(() => {
    isUsingDefaultKey()
      .then(setIsDefaultKey)
      .catch(() => setIsDefaultKey(false));
  }, []);

  useEffect(() => {
    startup.current = forgetKeyFromEarlierInstall().catch(() => {});
    startup.current.then(refreshIsDefaultKey);
  }, [refreshIsDefaultKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        if (!isLockedRef.current) setKeepCaptureBlocked(true);
        if (suspended.current > 0) {
          leftWhileSuspended.current = true;
          return;
        }
        lockNow();
      } else if (state === 'active') {
        setKeepCaptureBlocked(false);
      }
    });
    return () => subscription.remove();
  }, [lockNow]);

  const withoutAutoLock = useCallback(
    async <T,>(task: () => Promise<T>) => {
      suspended.current++;
      try {
        return await task();
      } finally {
        suspended.current--;
        if (suspended.current === 0 && leftWhileSuspended.current) {
          leftWhileSuspended.current = false;
          // Came back from the picker to somewhere other than Ghost: lock now.
          if (AppState.currentState !== 'active') lockNow();
        }
      }
    },
    [lockNow],
  );

  const unlock = useCallback(async (key: string) => {
    const startedAt = lockCount.current;
    await startup.current;
    const ok = await verifyMasterKey(key);
    if (!ok) return false;
    // Locked again (or left the app) while the key was being checked.
    if (lockCount.current !== startedAt || AppState.currentState !== 'active') return false;
    setIsLocked(false);
    if (key.trim().toLowerCase() === DEFAULT_MASTER_KEY) {
      showAlert(
        'Choose your own master key',
        `You opened Ghost with the starting key "${DEFAULT_MASTER_KEY}", which anyone who knows Ghost could guess. Set your own in Settings → Game disguise.`,
        undefined,
        { icon: 'key-outline' },
      );
    }
    return true;
  }, []);

  const lock = lockNow;

  const changeKey = useCallback(async (key: string) => {
    await setMasterKey(key);
    setIsDefaultKey(false);
  }, []);

  const isCaptureBlocked = !isLocked || keepCaptureBlocked;

  const value = useMemo(
    () => ({ isLocked, isCaptureBlocked, isDefaultKey, unlock, lock, changeKey, withoutAutoLock }),
    [isLocked, isCaptureBlocked, isDefaultKey, unlock, lock, changeKey, withoutAutoLock],
  );

  return <DisguiseContext.Provider value={value}>{children}</DisguiseContext.Provider>;
}

export function useDisguise() {
  const context = useContext(DisguiseContext);
  if (!context) throw new Error('useDisguise must be used inside DisguiseProvider');
  return context;
}

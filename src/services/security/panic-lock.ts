import { requireOptionalNativeModule } from 'expo';
import { BackHandler, Platform } from 'react-native';

import { clearDeviceKeyCache } from '@/services/encryption/device-keys';

// Local native module (modules/panic-lock). Missing in Expo Go and on web.
const PanicLock = requireOptionalNativeModule<{ exit(): void }>('PanicLock');

// Closes Ghost immediately and kills its process so nothing stays in RAM.
// The identity and chats are untouched: opening Ghost again picks up where
// the person left off.
export function panicLock() {
  // Drop key material first, in case the process outlives this call.
  clearDeviceKeyCache();

  if (PanicLock) {
    PanicLock.exit();
  } else if (Platform.OS === 'android') {
    BackHandler.exitApp();
  }
}

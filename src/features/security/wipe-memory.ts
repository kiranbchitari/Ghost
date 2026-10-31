import { clearDialogs } from '@/components/dialog';
import { sweepTemporaryPhotos } from '@/features/burn-photo/pick-image';
import { clearDecryptedImages } from '@/features/messaging/attachments';
import { clearDeviceKeyCache } from '@/services/encryption/device-keys';

// Work that must happen while keys are still in memory (a chat sealing its
// draft), run just before each wipe.
const beforeWipe = new Set<() => void>();
export function onBeforeWipe(callback: () => void) {
  beforeWipe.add(callback);
  return () => {
    beforeWipe.delete(callback);
  };
}

// Everything secret Ghost holds in memory: keys (identity, chats, drafts),
// decrypted photos, leftover temporary photo files, and any open dialog (whose buttons could still act on a
// chat). Called whenever Ghost locks, so nothing outlives the lock.
export function wipeSecretsFromMemory() {
  beforeWipe.forEach((callback) => {
    try {
      callback();
    } catch (e) {
      console.warn('Before-wipe step failed:', (e as Error).message);
    }
  });
  clearDeviceKeyCache();
  clearDecryptedImages();
  clearDialogs();
  // And any temporary photo file a crash or interruption left in the cache.
  sweepTemporaryPhotos();
}

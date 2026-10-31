import * as SecureStore from 'expo-secure-store';

import {
  decodeKey,
  deriveSharedKey,
  encodeKey,
  generateSecretKey,
  publicKeyFor,
} from '@/services/encryption/box';
import { clearDraftKeyCache, deleteAllDrafts } from '@/services/storage/encrypted-drafts';
import { supabase } from '@/services/supabase/client';

export type DeviceKeyPair = { publicKey: string; secretKey: Uint8Array };

const storageKey = (userId: string) => `ghost.e2e.secret.${userId}`;

const keyPairs = new Map<string, Promise<DeviceKeyPair>>();
const sharedKeys = new Map<string, Uint8Array>();
// Bumped by every wipe, so a load that was in flight doesn't put a key back.
let generation = 0;

// The user's key pair: loaded from SecureStore, or created on first use. The
// public half is published to the user's profile so friends can encrypt to it.
export function getDeviceKeyPair(userId: string) {
  let pending = keyPairs.get(userId);
  if (!pending) {
    pending = loadOrCreate(userId);
    keyPairs.set(userId, pending);
    pending.catch(() => keyPairs.delete(userId)); // allow a retry
  }
  return pending;
}

export async function getSharedKey(userId: string, friendPublicKey: string) {
  const startedAt = generation;
  const { publicKey, secretKey } = await getDeviceKeyPair(userId);
  if (generation !== startedAt) throw new Error('Keys were cleared. Open the chat again.');
  const cacheKey = `${publicKey}:${friendPublicKey}`;
  let key = sharedKeys.get(cacheKey);
  if (!key) {
    key = deriveSharedKey(friendPublicKey, secretKey);
    sharedKeys.set(cacheKey, key);
  }
  return key;
}

// Destroys the private key. Messages for this identity become unreadable.
// Its encrypted drafts and their key go too.
export async function deleteDeviceKeyPair(userId: string) {
  keyPairs.delete(userId);
  sharedKeys.clear();
  await SecureStore.deleteItemAsync(storageKey(userId));
  await deleteAllDrafts(userId).catch((e: Error) => console.warn('Deleting drafts failed:', e.message));
}

// Forgets every key held in memory (the stored private key is untouched).
export function clearDeviceKeyCache() {
  generation++;
  keyPairs.forEach((pending) => pending.then(({ secretKey }) => secretKey.fill(0)).catch(() => {}));
  keyPairs.clear();
  sharedKeys.forEach((key) => key.fill(0));
  sharedKeys.clear();
  clearDraftKeyCache();
}

async function loadOrCreate(userId: string): Promise<DeviceKeyPair> {
  const stored = await SecureStore.getItemAsync(storageKey(userId));
  const secretKey = stored ? decodeKey(stored) : generateSecretKey();
  if (!stored) {
    await SecureStore.setItemAsync(storageKey(userId), encodeKey(secretKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  const publicKey = publicKeyFor(secretKey);

  const { data, error } = await supabase.from('profiles').select('public_key').single();
  if (error) throw new Error(error.message);
  if (data.public_key !== publicKey) {
    const { error: setError } = await supabase.rpc('set_public_key', { p_public_key: publicKey });
    if (setError) throw new Error(setError.message);
  }

  return { publicKey, secretKey };
}

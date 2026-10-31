import * as SecureStore from 'expo-secure-store';

import {
  decodeKey,
  deriveSharedKey,
  encodeKey,
  generateSecretKey,
  publicKeyFor,
} from '@/services/encryption/box';
import { supabase } from '@/services/supabase/client';

export type DeviceKeyPair = { publicKey: string; secretKey: Uint8Array };

const storageKey = (userId: string) => `ghost.e2e.secret.${userId}`;

const keyPairs = new Map<string, Promise<DeviceKeyPair>>();
const sharedKeys = new Map<string, Uint8Array>();

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
  const { publicKey, secretKey } = await getDeviceKeyPair(userId);
  const cacheKey = `${publicKey}:${friendPublicKey}`;
  let key = sharedKeys.get(cacheKey);
  if (!key) {
    key = deriveSharedKey(friendPublicKey, secretKey);
    sharedKeys.set(cacheKey, key);
  }
  return key;
}

// Destroys the private key. Messages for this identity become unreadable.
export async function deleteDeviceKeyPair(userId: string) {
  keyPairs.delete(userId);
  sharedKeys.clear();
  await SecureStore.deleteItemAsync(storageKey(userId));
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

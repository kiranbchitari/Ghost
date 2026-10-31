import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { decodeKey, encodeKey, generateSymmetricKey, openLocal, sealLocal } from '@/services/encryption/box';

// Unsent messages, kept per chat across restarts. Each draft is sealed with
// NaCl secretbox under a per-identity key held in SecureStore (Keychain /
// Keystore); only ciphertext is written to AsyncStorage. Destroying the key
// (Reset identity, Reset game data) makes every draft unreadable, and the
// ciphertext is removed with it.

export type Draft = {
  text: string;
  // The message the draft replies to, if any.
  replyTo?: string | null;
};

const keyName = (userId: string) => `ghost.drafts.key.${userId}`;
const itemPrefix = (userId: string) => `ghost.draft.${userId}.`;
const itemName = (userId: string, conversationId: string) => `${itemPrefix(userId)}${conversationId}`;

// The key for the signed-in identity, kept in memory once loaded.
let cached: { userId: string; key: Uint8Array } | null = null;
// Bumped whenever the cache is cleared, so a load in flight doesn't refill it.
let generation = 0;
// Key loads run one at a time, so two first saves can't each create a key.
let keyLock: Promise<unknown> = Promise.resolve();
// Identities whose drafts were destroyed. Nothing is loaded, created or saved
// for them again, so a save that starts mid-wipe can't bring a key back.
// (Wiping always comes with a new identity, so this never needs clearing.)
const wiped = new Set<string>();

async function readKey(userId: string, create: boolean) {
  const stored = await SecureStore.getItemAsync(keyName(userId));
  if (stored) return decodeKey(stored);
  if (!create) return null;
  const key = generateSymmetricKey();
  await SecureStore.setItemAsync(keyName(userId), encodeKey(key), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

function getKey(userId: string, create: boolean): Promise<Uint8Array | null> {
  if (wiped.has(userId)) return Promise.resolve(null);
  if (cached?.userId === userId) return Promise.resolve(cached.key);
  const startedAt = generation;
  const run = keyLock
    .catch(() => {})
    .then(async () => {
      if (wiped.has(userId)) return null;
      if (cached?.userId === userId) return cached.key;
      const key = await readKey(userId, create);
      if (key && generation === startedAt) cached = { userId, key };
      return key;
    });
  keyLock = run;
  return run;
}

// Writes per chat run one after another, so an older save can't land last.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(name: string, task: () => Promise<T>) {
  const run = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(name, run);
  run
    .finally(() => {
      if (queues.get(name) === run) queues.delete(name);
    })
    .catch(() => {});
  return run;
}

// Lets the chat list update its "Draft:" previews.
const listeners = new Set<(conversationId: string, draft: Draft | null) => void>();
export function subscribeToDrafts(listener: (conversationId: string, draft: Draft | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function parse(raw: string | null, key: Uint8Array): Draft | null {
  if (!raw) return null;
  try {
    const sealed = JSON.parse(raw) as { c: string; n: string };
    const plaintext = openLocal({ ciphertext: sealed.c, nonce: sealed.n }, key);
    if (!plaintext) return null;
    const draft = JSON.parse(plaintext) as Draft;
    return typeof draft.text === 'string' ? draft : null;
  } catch {
    return null;
  }
}

// Also gets the key ready (creating it the first time), so the draft can be
// saved on the way out of the chat without touching SecureStore then.
export async function loadDraft(userId: string, conversationId: string) {
  const name = itemName(userId, conversationId);
  // Wait for any save still in flight for this chat.
  await queues.get(name)?.catch(() => {});
  const [raw, key] = await Promise.all([AsyncStorage.getItem(name), getKey(userId, true)]);
  return raw && key ? parse(raw, key) : null;
}

// Drafts for the chat list, by conversation id. Missing or unreadable ones
// are left out.
export async function loadDrafts(userId: string, conversationIds: string[]) {
  const drafts = new Map<string, Draft>();
  if (conversationIds.length === 0) return drafts;
  const entries = await AsyncStorage.multiGet(conversationIds.map((id) => itemName(userId, id)));
  if (!entries.some(([, raw]) => raw)) return drafts;
  const key = await getKey(userId, false);
  if (!key) return drafts;
  entries.forEach(([, raw], index) => {
    const draft = parse(raw, key);
    if (draft) drafts.set(conversationIds[index], draft);
  });
  return drafts;
}

// Saves the draft, or removes it when there's nothing in it. With
// `onlyIfKeyInMemory`, does nothing unless the key is already loaded: used on
// the way out of a chat, so a panic that just wiped keys from memory doesn't
// bring the key back.
export function saveDraft(
  userId: string,
  conversationId: string,
  draft: Draft | null,
  options: { onlyIfKeyInMemory?: boolean } = {},
) {
  const name = itemName(userId, conversationId);
  const isEmpty = !draft || (!draft.text.trim() && !draft.replyTo);
  const seal = (key: Uint8Array) =>
    sealLocal(JSON.stringify({ text: draft!.text, replyTo: draft!.replyTo ?? null }), key);
  // With the key in memory, seal right now (synchronously), so a wipe that
  // follows this call, e.g. on lock, can't catch the draft unsealed.
  const sealedNow = !isEmpty && cached?.userId === userId ? seal(cached.key) : null;
  return enqueue(name, async () => {
    if (wiped.has(userId)) return;
    if (isEmpty) {
      await AsyncStorage.removeItem(name);
      listeners.forEach((listener) => listener(conversationId, null));
      return;
    }
    let sealed = sealedNow;
    if (!sealed) {
      if (options.onlyIfKeyInMemory) return;
      const key = await getKey(userId, true);
      if (!key) return;
      sealed = seal(key);
    }
    await AsyncStorage.setItem(name, JSON.stringify({ c: sealed.ciphertext, n: sealed.nonce }));
    listeners.forEach((listener) => listener(conversationId, draft));
  });
}

// Forgets the key held in memory (the stored key and drafts are untouched).
export function clearDraftKeyCache() {
  cached?.key.fill(0);
  cached = null;
  generation++;
}

// Destroys the key and every draft of this identity.
export async function deleteAllDrafts(userId: string) {
  wiped.add(userId);
  if (cached?.userId === userId) clearDraftKeyCache();
  // Let saves and key loads already under way finish first (later ones see
  // the identity is wiped and do nothing), so none lands after the wipe.
  await Promise.all([...queues.values(), keyLock].map((run) => run.catch(() => {})));
  const prefix = itemPrefix(userId);
  const names = (await AsyncStorage.getAllKeys()).filter((name) => name.startsWith(prefix));
  if (names.length) await AsyncStorage.multiRemove(names);
  await SecureStore.deleteItemAsync(keyName(userId));
}

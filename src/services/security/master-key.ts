import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64 } from 'tweetnacl-util';

// The master key that unlocks Ghost from behind the Snake game. Only a salted,
// stretched hash is kept (in SecureStore); the key itself is never stored.
// Until one is set (a fresh install), the starting key "ghost" opens it.
const STORAGE_KEY = 'ghost.disguise.masterKey';
export const DEFAULT_MASTER_KEY = 'ghost';
const ROUNDS = 5000;
export const MIN_MASTER_KEY_LENGTH = 4;

type Stored = { salt: string; hash: string; rounds: number };

// Repeated SHA-512 over salt + key: slows down guessing a stolen hash.
function stretch(key: string, salt: Uint8Array, rounds: number) {
  const keyBytes = decodeUTF8(key);
  let digest = nacl.hash(new Uint8Array([...salt, ...keyBytes]));
  for (let i = 1; i < rounds; i++) {
    const next = new Uint8Array(digest.length + keyBytes.length);
    next.set(digest);
    next.set(keyBytes, digest.length);
    digest = nacl.hash(next);
  }
  return digest;
}

// Constant-time comparison, so timing doesn't reveal how close a guess was.
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function load(): Promise<Stored | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Stored) : null;
}

// True while the starting key "ghost" is still the way in.
export async function isUsingDefaultKey() {
  return (await load()) === null;
}

export async function setMasterKey(rawKey: string) {
  // Redeem trims what's typed, so a key with surrounding spaces could never be
  // entered again: store it trimmed too.
  const key = rawKey.trim();
  if (key.length < MIN_MASTER_KEY_LENGTH) {
    throw new Error(`The master key needs at least ${MIN_MASTER_KEY_LENGTH} characters.`);
  }
  if (key.trim().toLowerCase() === DEFAULT_MASTER_KEY) {
    throw new Error('Choose something other than the starting key.');
  }
  const salt = nacl.randomBytes(16);
  const stored: Stored = { salt: encodeBase64(salt), hash: encodeBase64(stretch(key, salt, ROUNDS)), rounds: ROUNDS };
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(stored));
}

export async function clearMasterKey() {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

// After a few wrong keys, every try fails for a while, right or wrong, so the
// key can't be guessed by typing quickly. Kept in SecureStore, so killing and
// relaunching the app doesn't reset the count.
const FREE_TRIES = 5;
const LOCKOUT_MS = 60_000;
const LOCKOUT_KEY = 'ghost.disguise.lockout';
type Lockout = { failures: number; lockedUntil: number };

async function loadLockout(): Promise<Lockout> {
  const raw = await SecureStore.getItemAsync(LOCKOUT_KEY);
  if (!raw) return { failures: 0, lockedUntil: 0 };
  const value = JSON.parse(raw) as Lockout;
  return { failures: Number(value.failures) || 0, lockedUntil: Number(value.lockedUntil) || 0 };
}

async function saveLockout(lockout: Lockout) {
  await SecureStore.setItemAsync(LOCKOUT_KEY, JSON.stringify(lockout));
}

// Fails closed: if the stored key or the lockout can't be read, or the stored
// hash is damaged, nothing opens Ghost (not even the starting key), so a
// storage problem can't become a way in.
export async function verifyMasterKey(key: string) {
  let lockout: Lockout;
  let stored: Stored | null;
  try {
    lockout = await loadLockout();
    if (Date.now() < lockout.lockedUntil) return false;
    stored = await load();
  } catch {
    return false;
  }

  let ok: boolean;
  try {
    ok = stored
      ? sameBytes(stretch(key, decodeBase64(stored.salt), stored.rounds), decodeBase64(stored.hash))
      : key.trim().toLowerCase() === DEFAULT_MASTER_KEY;
  } catch {
    return false;
  }

  const next: Lockout = ok
    ? { failures: 0, lockedUntil: 0 }
    : lockout.failures + 1 >= FREE_TRIES
      ? { failures: 0, lockedUntil: Date.now() + LOCKOUT_MS }
      : { failures: lockout.failures + 1, lockedUntil: 0 };
  try {
    if (next.failures !== lockout.failures || next.lockedUntil !== lockout.lockedUntil) await saveLockout(next);
  } catch {
    // Can't record a wrong try: refuse rather than allow unlimited guessing.
    if (!ok) return false;
  }
  return ok;
}

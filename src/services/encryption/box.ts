import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';

// tweetnacl looks for `self.crypto` at load time, which React Native doesn't
// reliably provide. Point it at the polyfilled CSPRNG explicitly.
nacl.setPRNG((out, n) => {
  out.set(crypto.getRandomValues(new Uint8Array(n)));
});

export type Encrypted = { ciphertext: string; nonce: string };

export function generateSecretKey() {
  return nacl.box.keyPair().secretKey;
}

export function publicKeyFor(secretKey: Uint8Array) {
  return encodeBase64(nacl.box.keyPair.fromSecretKey(secretKey).publicKey);
}

// X25519 shared key. Both sides derive the same key from their own secret key
// and the other's public key, so either can decrypt every message.
export function deriveSharedKey(theirPublicKey: string, mySecretKey: Uint8Array) {
  return nacl.box.before(decodeBase64(theirPublicKey), mySecretKey);
}

// A key zero-filled by a panic/lock wipe must never be used: anything sealed
// with it would be unreadable to the friend and trivially readable to others.
function assertLiveKey(key: Uint8Array) {
  if (key.every((b) => b === 0)) throw new Error('The encryption key was cleared. Open the chat again.');
}

export function encrypt(plaintext: string, sharedKey: Uint8Array): Encrypted {
  assertLiveKey(sharedKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(decodeUTF8(plaintext), nonce, sharedKey);
  return { ciphertext: encodeBase64(box), nonce: encodeBase64(nonce) };
}

// Returns null if the message was tampered with or encrypted for someone else.
export function decrypt({ ciphertext, nonce }: Encrypted, sharedKey: Uint8Array) {
  try {
    const opened = nacl.box.open.after(decodeBase64(ciphertext), decodeBase64(nonce), sharedKey);
    return opened ? encodeUTF8(opened) : null;
  } catch {
    return null;
  }
}

// Raw bytes (photos). Same box as messages, with its own random nonce.
export function encryptBytes(bytes: Uint8Array, sharedKey: Uint8Array) {
  assertLiveKey(sharedKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  return { data: nacl.box.after(bytes, nonce, sharedKey), nonce: encodeBase64(nonce) };
}

export function decryptBytes(data: Uint8Array, nonce: string, sharedKey: Uint8Array) {
  try {
    return nacl.box.open.after(data, decodeBase64(nonce), sharedKey);
  } catch {
    return null;
  }
}

// Symmetric encryption for data that never leaves this phone (drafts):
// XSalsa20-Poly1305 with a 32-byte key and a fresh random nonce each time.
export function generateSymmetricKey() {
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

export function sealLocal(plaintext: string, key: Uint8Array): Encrypted {
  assertLiveKey(key);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(decodeUTF8(plaintext), nonce, key);
  return { ciphertext: encodeBase64(box), nonce: encodeBase64(nonce) };
}

// Returns null if the data was tampered with or sealed with another key.
export function openLocal({ ciphertext, nonce }: Encrypted, key: Uint8Array) {
  try {
    const opened = nacl.secretbox.open(decodeBase64(ciphertext), decodeBase64(nonce), key);
    return opened ? encodeUTF8(opened) : null;
  } catch {
    return null;
  }
}

// 128-bit random hex id, e.g. for attachment file names.
// Random version 4 UUID (Hermes has no crypto.randomUUID).
export function randomUuid() {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomId() {
  return Array.from(nacl.randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const encodeKey = encodeBase64;
export const decodeKey = decodeBase64;
export const encodeBytes = encodeBase64;
export const decodeBytes = decodeBase64;

import { useEffect, useState } from 'react';

import {
  deleteAttachment,
  downloadAttachment,
  uploadAttachment,
} from '@/features/messaging/api';
import type { ImageEnvelope } from '@/features/messaging/crypto';
import {
  decodeBytes,
  decryptBytes,
  encodeBytes,
  encryptBytes,
  randomId,
} from '@/services/encryption/box';

// Decrypted photos live only in memory, as data URIs, keyed by message id.
// Nothing is written to disk; restarting the app or deleting the message
// drops them.
const decrypted = new Map<string, string>();
// Photos whose messages were deleted, burned or opened (view once): a download
// still under way for one of them must not put it back in memory.
const forgotten = new Set<string>();

export function forgetImage(messageId: string) {
  forgotten.add(messageId);
  decrypted.delete(messageId);
}

// Drops every decrypted photo (on lock, panic and identity reset).
export function clearDecryptedImages() {
  decrypted.clear();
}

// Encrypts a JPEG (base64) with the chat key and uploads the ciphertext.
// Returns the storage path and the envelope to encrypt into the message.
export async function encryptAndUploadImage(
  conversationId: string,
  image: { base64: string; width: number; height: number },
  sharedKey: Uint8Array,
) {
  const { data, nonce } = encryptBytes(decodeBytes(image.base64), sharedKey);
  const path = `${conversationId}/${randomId()}`;
  await uploadAttachment(path, encodeBytes(data));

  const envelope: ImageEnvelope = { v: 1, nonce, width: image.width, height: image.height };
  return { path, envelope };
}

export async function removeUploadedImage(path: string) {
  await deleteAttachment(path).catch((e: Error) =>
    console.warn('Deleting encrypted photo failed:', e.message),
  );
}

async function loadImage(
  messageId: string,
  path: string,
  envelope: ImageEnvelope,
  sharedKey: Uint8Array,
) {
  const cached = decrypted.get(messageId);
  if (cached) return cached;

  const ciphertext = decodeBytes(await downloadAttachment(path));
  const bytes = decryptBytes(ciphertext, envelope.nonce, sharedKey);
  if (!bytes) throw new Error("Couldn't decrypt this photo");

  const uri = `data:image/jpeg;base64,${encodeBytes(bytes)}`;
  if (forgotten.has(messageId)) throw new Error('This photo is gone');
  decrypted.set(messageId, uri);
  return uri;
}

// Downloads and decrypts a photo when `enabled`, keeping it in memory only.
export function useDecryptedImage(
  messageId: string,
  path: string | null,
  envelope: ImageEnvelope | null,
  sharedKey: Uint8Array | null,
  enabled = true,
) {
  const [uri, setUri] = useState<string | null>(() => decrypted.get(messageId) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !path || !envelope || !sharedKey) return;
    let cancelled = false;

    loadImage(messageId, path, envelope, sharedKey)
      .then((value) => !cancelled && setUri(value))
      .catch((e: Error) => !cancelled && setError(e.message));

    return () => {
      cancelled = true;
    };
    // The envelope object is rebuilt on every render; its nonce identifies it.
  }, [messageId, path, envelope?.nonce, sharedKey, enabled]);

  return { uri, error };
}

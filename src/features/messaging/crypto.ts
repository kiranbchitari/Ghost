import { decrypt } from '@/services/encryption/box';

import type { Message } from '@/features/messaging/api';

// What an image message's ciphertext decrypts to. The photo itself is a
// separate encrypted file; this holds the nonce needed to open it.
export type ImageEnvelope = { v: 1; nonce: string; width: number; height: number };

export type MessageContent = {
  // null when the message can't be decrypted (or has no text, e.g. a photo).
  text: string | null;
  image: ImageEnvelope | null;
  isEncrypted: boolean;
  isDeleted: boolean;
};

// Turns a stored message (encrypted, legacy plaintext or deleted) into
// something displayable.
export function openContent(
  stored: Pick<Message, 'body' | 'ciphertext' | 'nonce'> &
    Partial<Pick<Message, 'kind' | 'deleted_at'>>,
  sharedKey: Uint8Array | null,
): MessageContent {
  if (stored.deleted_at) return { text: null, image: null, isEncrypted: true, isDeleted: true };

  if (stored.ciphertext && stored.nonce) {
    const plaintext = sharedKey
      ? decrypt({ ciphertext: stored.ciphertext, nonce: stored.nonce }, sharedKey)
      : null;

    if (stored.kind === 'image') {
      return { text: null, image: parseEnvelope(plaintext), isEncrypted: true, isDeleted: false };
    }
    return { text: plaintext, image: null, isEncrypted: true, isDeleted: false };
  }

  return { text: stored.body, image: null, isEncrypted: false, isDeleted: false };
}

function parseEnvelope(plaintext: string | null): ImageEnvelope | null {
  if (!plaintext) return null;
  try {
    const value = JSON.parse(plaintext) as ImageEnvelope;
    return value.v === 1 && typeof value.nonce === 'string' ? value : null;
  } catch {
    return null;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listReactions, setReaction, type StoredReaction } from '@/features/messaging/api';
import { decrypt, encrypt } from '@/services/encryption/box';
import { supabase } from '@/services/supabase/client';

// WhatsApp's quick reactions, shown in the tray above a message.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export type ReactionChip = { userId: string; emoji: string; isMine: boolean };

// Plenty for any emoji (ZWJ families and flags included), and keeps a
// tampered reaction from smuggling in a paragraph.
const MAX_EMOJI_LENGTH = 32;
// Message ids per request, to keep the query string short.
const CHUNK = 100;

const rowKey = (messageId: string, userId: string) => `${messageId}:${userId}`;

// Reactions for the messages on screen, live. Each member has at most one per
// message; the emoji is encrypted with the chat's shared key. Without the
// reactions migration nothing loads and nothing is shown.
export function useReactions(
  conversationId: string,
  messageIds: readonly string[],
  sharedKey: Uint8Array | null,
  userId: string | undefined,
) {
  const [rows, setRows] = useState<ReadonlyMap<string, StoredReaction>>(new Map());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const fetched = useRef(new Set<string>());
  const idsRef = useRef(messageIds);
  idsRef.current = messageIds;
  const hasWarned = useRef(false);

  // Replaces what we hold for these messages with what the server has.
  const fetchFor = useCallback(
    async (ids: readonly string[]) => {
      ids.forEach((id) => fetched.current.add(id));
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        try {
          const loaded = await listReactions(conversationId, chunk);
          setRows((prev) => {
            const next = new Map(prev);
            const inChunk = new Set(chunk);
            for (const [key, row] of prev) if (inChunk.has(row.message_id)) next.delete(key);
            for (const row of loaded) next.set(rowKey(row.message_id, row.user_id), row);
            return next;
          });
        } catch (e) {
          if (!hasWarned.current) console.warn('Loading reactions failed:', (e as Error).message);
          hasWarned.current = true;
        }
      }
    },
    [conversationId],
  );

  // Only messages we haven't asked about yet: a new one, or an older page.
  const idsKey = messageIds.join(',');
  useEffect(() => {
    const fresh = idsRef.current.filter((id) => !fetched.current.has(id));
    if (fresh.length) fetchFor(fresh);
  }, [idsKey, fetchFor]);

  useEffect(() => {
    const apply = (payload: { new: object }) => {
      const row = payload.new as StoredReaction;
      if (!row.message_id || !row.user_id) return;
      setRows((prev) => new Map(prev).set(rowKey(row.message_id, row.user_id), row));
    };
    const filter = `conversation_id=eq.${conversationId}`;
    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter }, apply)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions', filter }, apply)
      .subscribe((status) => {
        // Back after a drop: catch up on everything on screen.
        if (status === 'SUBSCRIBED' && fetched.current.size) fetchFor([...fetched.current]);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, fetchFor]);

  // Decrypted chips per message, oldest reaction first.
  const decrypted = useRef(new Map<string, string | null>());
  const byMessage = useMemo(() => {
    const map = new Map<string, ReactionChip[]>();
    if (!sharedKey) return map;
    const sorted = [...rows.values()].sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    for (const row of sorted) {
      if (!row.ciphertext || !row.nonce) continue;
      let emoji = decrypted.current.get(row.ciphertext);
      if (emoji === undefined) {
        const plaintext = decrypt({ ciphertext: row.ciphertext, nonce: row.nonce }, sharedKey);
        emoji = plaintext && plaintext.trim() && plaintext.length <= MAX_EMOJI_LENGTH ? plaintext : null;
        decrypted.current.set(row.ciphertext, emoji);
      }
      if (!emoji) continue;
      const chips = map.get(row.message_id) ?? [];
      chips.push({ userId: row.user_id, emoji, isMine: row.user_id === userId });
      map.set(row.message_id, chips);
    }
    return map;
  }, [rows, sharedKey, userId]);

  // Sets your reaction (null removes it). Shown at once; put back if the
  // server refuses.
  const react = useCallback(
    async (messageId: string, emoji: string | null) => {
      if (!sharedKey || !userId) throw new Error('Encryption is not ready for this chat yet.');
      const key = rowKey(messageId, userId);
      const previous = rowsRef.current.get(key);
      const encrypted = emoji ? encrypt(emoji, sharedKey) : null;
      const optimistic: StoredReaction = {
        message_id: messageId,
        conversation_id: conversationId,
        user_id: userId,
        ciphertext: encrypted?.ciphertext ?? null,
        nonce: encrypted?.nonce ?? null,
        updated_at: new Date().toISOString(),
      };
      setRows((prev) => new Map(prev).set(key, optimistic));
      try {
        await setReaction(messageId, encrypted);
      } catch (e) {
        setRows((prev) => {
          if (prev.get(key) !== optimistic) return prev;
          const next = new Map(prev);
          if (previous) next.set(key, previous);
          else next.delete(key);
          return next;
        });
        throw e;
      }
    },
    [conversationId, sharedKey, userId],
  );

  return { reactions: byMessage, react };
}

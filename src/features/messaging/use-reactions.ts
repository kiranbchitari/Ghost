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
// New ids are gathered for this long and fetched together, so a burst of
// incoming messages costs one request rather than one each.
const BATCH_MS = 300;

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
  // Every local change (live update or your own reaction) gets a number, so a
  // fetch that was already under way can tell which rows changed after it
  // started and must not be overwritten with its older snapshot.
  const changeCount = useRef(0);
  const changedAt = useRef(new Map<string, number>());

  // Sets (or with null, drops) one row and records that it changed here.
  const setRow = useCallback((row: StoredReaction | null, key: string) => {
    changedAt.current.set(key, ++changeCount.current);
    setRows((prev) => {
      const next = new Map(prev);
      if (row) next.set(key, row);
      else next.delete(key);
      return next;
    });
  }, []);

  // Replaces what we hold for these messages with what the server has, except
  // rows that changed here while the request was out.
  const fetchFor = useCallback(
    async (ids: readonly string[]) => {
      ids.forEach((id) => fetched.current.add(id));
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
      await Promise.all(
        chunks.map(async (chunk) => {
          const startedAt = changeCount.current;
          try {
            const loaded = await listReactions(conversationId, chunk);
            const isNewer = (key: string) => (changedAt.current.get(key) ?? 0) > startedAt;
            setRows((prev) => {
              const next = new Map(prev);
              const inChunk = new Set(chunk);
              for (const [key, row] of prev) if (inChunk.has(row.message_id) && !isNewer(key)) next.delete(key);
              for (const row of loaded) {
                const key = rowKey(row.message_id, row.user_id);
                if (!isNewer(key)) next.set(key, row);
              }
              return next;
            });
          } catch (e) {
            // Not fetched after all: ask again with the next batch or reconnect.
            chunk.forEach((id) => fetched.current.delete(id));
            if (!hasWarned.current) console.warn('Loading reactions failed:', (e as Error).message);
            hasWarned.current = true;
          }
        }),
      );
    },
    [conversationId],
  );

  // Only messages we haven't asked about yet: new ones, or an older page,
  // gathered briefly so a burst becomes one request.
  const idsKey = messageIds.join(',');
  useEffect(() => {
    const timer = setTimeout(() => {
      const fresh = idsRef.current.filter((id) => !fetched.current.has(id));
      if (fresh.length) fetchFor(fresh);
    }, BATCH_MS);
    return () => clearTimeout(timer);
  }, [idsKey, fetchFor]);

  useEffect(() => {
    const apply = (payload: { new: object }) => {
      const row = payload.new as StoredReaction;
      if (!row.message_id || !row.user_id) return;
      setRow(row, rowKey(row.message_id, row.user_id));
    };
    const filter = `conversation_id=eq.${conversationId}`;
    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter }, apply)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions', filter }, apply)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // Live updates only flow from here on: catch up on whatever changed
        // before (including between the first fetch and this join), for the
        // messages still loaded. Ones that burned or were erased are dropped.
        const loaded = new Set(idsRef.current);
        for (const id of fetched.current) if (!loaded.has(id)) fetched.current.delete(id);
        if (fetched.current.size) fetchFor([...fetched.current]);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, fetchFor, setRow]);

  // Decrypted chips per message, oldest reaction first. A message whose
  // reactions didn't change keeps the same array, so its bubble (memoised)
  // doesn't re-render when someone reacts to another message.
  const decrypted = useRef(new Map<string, string | null>());
  const previous = useRef(new Map<string, ReactionChip[]>());
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
    for (const [messageId, chips] of map) {
      const before = previous.current.get(messageId);
      if (before && sameChips(before, chips)) map.set(messageId, before);
    }
    previous.current = map;
    return map;
  }, [rows, sharedKey, userId]);

  // Sets your reaction (null removes it). Shown at once; put back if the
  // server refuses.
  const react = useCallback(
    async (messageId: string, emoji: string | null) => {
      if (!sharedKey || !userId) throw new Error('Encryption is not ready for this chat yet.');
      const key = rowKey(messageId, userId);
      const before = rowsRef.current.get(key);
      const encrypted = emoji ? encrypt(emoji, sharedKey) : null;
      const optimistic: StoredReaction = {
        message_id: messageId,
        conversation_id: conversationId,
        user_id: userId,
        ciphertext: encrypted?.ciphertext ?? null,
        nonce: encrypted?.nonce ?? null,
        updated_at: new Date().toISOString(),
      };
      setRow(optimistic, key);
      try {
        await setReaction(messageId, encrypted);
      } catch (e) {
        // Put back what was there, unless something newer arrived meanwhile.
        if (rowsRef.current.get(key) === optimistic) setRow(before ?? null, key);
        throw e;
      }
    },
    [conversationId, sharedKey, userId, setRow],
  );

  return { reactions: byMessage, react };
}

function sameChips(a: readonly ReactionChip[], b: readonly ReactionChip[]) {
  return (
    a.length === b.length &&
    a.every((chip, i) => chip.userId === b[i].userId && chip.emoji === b[i].emoji && chip.isMine === b[i].isMine)
  );
}

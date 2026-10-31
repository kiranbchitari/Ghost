import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { listConversations, type ConversationSummary } from '@/features/messaging/api';
import { openContent } from '@/features/messaging/crypto';
import { useSession } from '@/hooks/use-session';
import { getSharedKey } from '@/services/encryption/device-keys';
import { loadDrafts, subscribeToDrafts } from '@/services/storage/encrypted-drafts';
import { supabase } from '@/services/supabase/client';

export type ConversationPreview = ConversationSummary & {
  // Decrypted last message; null when the conversation has no messages.
  preview: string | null;
  // Unsent text saved on this phone, shown as "Draft: …" like WhatsApp.
  draft: string | null;
};

async function withPreview(userId: string, row: ConversationSummary): Promise<Omit<ConversationPreview, 'draft'>> {
  if (row.last_deleted) return { ...row, preview: '🔥 Message burned' };
  if (row.last_kind === 'image') return { ...row, preview: '📷 Photo' };
  if (row.last_body === null && row.last_ciphertext === null) return { ...row, preview: null };

  const key = row.friend_public_key ? await getSharedKey(userId, row.friend_public_key) : null;
  const { text } = openContent(
    { body: row.last_body, ciphertext: row.last_ciphertext, nonce: row.last_nonce },
    key,
  );
  return { ...row, preview: text ?? 'Encrypted message' };
}

export function useConversations() {
  const { session } = useSession();
  const userId = session?.user.id;
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Every message change anywhere reloads the list; reloads can overlap and
  // finish out of order. Only the newest one is applied.
  const latestReload = useRef(0);
  const reload = useCallback(async () => {
    if (!userId) return;
    const ticket = ++latestReload.current;
    try {
      const rows = await listConversations();
      const [previews, drafts] = await Promise.all([
        Promise.all(rows.map((row) => withPreview(userId, row))),
        loadDrafts(
          userId,
          rows.map((row) => row.conversation_id),
        ).catch(() => new Map<string, { text: string }>()),
      ]);
      if (ticket !== latestReload.current) return;
      setConversations(
        previews.map((row) => ({ ...row, draft: drafts.get(row.conversation_id)?.text.trim() || null })),
      );
      setError(null);
    } catch (e) {
      if (ticket === latestReload.current) setError((e as Error).message);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await reload();
    setIsRefreshing(false);
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // A chat saves its draft as it closes, which can be just after the list
  // has reloaded: take the change as it happens.
  useEffect(
    () =>
      subscribeToDrafts((conversationId, draft) => {
        const text = draft?.text.trim() || null;
        setConversations((prev) =>
          prev.some((c) => c.conversation_id === conversationId && c.draft !== text)
            ? prev.map((c) => (c.conversation_id === conversationId ? { ...c, draft: text } : c))
            : prev,
        );
      }),
    [],
  );

  // Any new message the user can see (RLS-filtered) may change the list order
  // or preview, so reload on every insert. Updates (read, deleted) change
  // unread counts.
  useEffect(() => {
    const channel = supabase
      .channel('conversation-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        reload();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
        reload();
      })
      // Also after a dropped connection comes back: catch up on the gap.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') reload();
      });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') reload();
    });
    return () => {
      supabase.removeChannel(channel);
      foreground.remove();
    };
  }, [reload]);

  return { conversations, error, isRefreshing, refresh };
}

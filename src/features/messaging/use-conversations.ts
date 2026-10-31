import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { listConversations, type ConversationSummary } from '@/features/messaging/api';
import { openContent } from '@/features/messaging/crypto';
import { useSession } from '@/hooks/use-session';
import { getSharedKey } from '@/services/encryption/device-keys';
import { supabase } from '@/services/supabase/client';

export type ConversationPreview = ConversationSummary & {
  // Decrypted last message; null when the conversation has no messages.
  preview: string | null;
};

async function withPreview(userId: string, row: ConversationSummary): Promise<ConversationPreview> {
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

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      const rows = await listConversations();
      setConversations(await Promise.all(rows.map((row) => withPreview(userId, row))));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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

  // Any new message the user can see (RLS-filtered) may change the list order
  // or preview, so reload on every insert.
  useEffect(() => {
    const channel = supabase
      .channel('conversation-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        reload();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  return { conversations, error, isRefreshing, refresh };
}

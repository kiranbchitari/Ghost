import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BURN_ANIMATION_MS, burnsAt } from '@/features/burn-mode/timer';
import {
  burnExpiredMessages,
  deleteMessage as deleteMessageRpc,
  eraseConversation,
  getConversation,
  getConversationSettings,
  listMessages,
  markConversationRead,
  markMessageViewed,
  sendMessage,
  setBurnTimer,
  type BurnMode,
  type ConversationPeer,
  type ConversationSettings,
  type Message,
} from '@/features/messaging/api';
import {
  encryptAndUploadImage,
  forgetImage,
  removeUploadedImage,
} from '@/features/messaging/attachments';
import { openContent, type MessageContent } from '@/features/messaging/crypto';
import { useAppState } from '@/hooks/use-app-state';
import { useSession } from '@/hooks/use-session';
import { encrypt } from '@/services/encryption/box';
import { getSharedKey } from '@/services/encryption/device-keys';
import { supabase } from '@/services/supabase/client';

export type DisplayMessage = Message &
  MessageContent & {
    // Burned by its timer or an erase: plays the burn, then disappears
    // entirely instead of leaving a "burned" placeholder.
    isExpired: boolean;
    // Seconds until it burns, once its timer has started.
    burnIn: number | null;
  };

// Newest first, de-duplicated by id: a sent message can arrive both from the
// insert response and from the realtime subscription.
function merge(incoming: Message[], existing: Message[]) {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function useMessages(conversationId: string) {
  const { session } = useSession();
  const userId = session?.user.id;
  const [messages, setMessages] = useState<Message[]>([]);
  const [peer, setPeer] = useState<ConversationPeer | null>(null);
  const [sharedKey, setSharedKey] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConversationSettings | null>(null);
  const [expiredIds, setExpiredIds] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Burns messages locally (animation, then removal) and asks the server to
  // delete whatever has expired there, removing their encrypted files.
  const expiredRef = useRef(new Set<string>());
  const expire = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => !expiredRef.current.has(id));
      if (fresh.length === 0) return;
      fresh.forEach((id) => {
        expiredRef.current.add(id);
        forgetImage(id);
      });
      setExpiredIds(new Set(expiredRef.current));

      const stamp = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => (fresh.includes(m.id) ? withUpdate(m, { ...m, deleted_at: stamp }) : m)),
      );
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => !fresh.includes(m.id)));
      }, BURN_ANIMATION_MS);
    },
    [],
  );

  const sweepServer = useCallback(() => {
    burnExpiredMessages(conversationId)
      .then((paths) => paths.forEach(removeUploadedImage))
      .catch((e: Error) => console.warn('Burning expired messages failed:', e.message));
  }, [conversationId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const loadedPeer = await getConversation(conversationId);
        if (cancelled) return;
        setPeer(loadedPeer);

        if (!loadedPeer.friend_public_key) {
          setError(`${loadedPeer.friend_code} hasn't set up encryption yet. Ask them to open Ghost.`);
          return;
        }
        const key = await getSharedKey(userId, loadedPeer.friend_public_key);
        if (!cancelled) setSharedKey(key);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, userId]);

  useEffect(() => {
    let cancelled = false;

    listMessages(conversationId)
      .then((loaded) => {
        if (cancelled) return;
        const at = Date.now();
        const live = loaded.filter((m) => {
          const due = burnsAt(m);
          return due === null || due > at;
        });
        if (live.length < loaded.length) sweepServer();
        setMessages((prev) => merge(live, prev));
      })
      .catch((e: Error) => !cancelled && setError(e.message));

    const filter = `conversation_id=eq.${conversationId}`;
    const insert = (payload: { new: object }) =>
      setMessages((prev) => merge([payload.new as Message], prev));
    // Only take the columns an UPDATE can change: receipts, view-once and
    // deletion. Postgres leaves unchanged TOASTed (large) values out of the
    // change feed, so a long message's ciphertext arrives missing and must
    // not overwrite what we have.
    const applyUpdate = (payload: { new: object }) => {
      const update = payload.new as Message;
      if (update.deleted_at || update.viewed_at) forgetImage(update.id);
      setMessages((prev) =>
        prev.map((m) => (m.id === update.id ? withUpdate(m, update) : m)),
      );
    };

    // INSERT: new messages. UPDATE: receipts, opened view-once photos, deletions.
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, insert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, applyUpdate)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, sweepServer]);

  // The conversation's burn timer and erasures, live from either member.
  useEffect(() => {
    let cancelled = false;
    let knownClearedAt: string | null | undefined;

    const apply = (next: ConversationSettings) => {
      setSettings(next);
      const erased = knownClearedAt !== undefined && next.cleared_at && next.cleared_at !== knownClearedAt;
      knownClearedAt = next.cleared_at;
      if (erased) {
        // The other person erased the chat: burn everything on screen.
        expire(messagesRef.current.map((m) => m.id));
      }
    };

    getConversationSettings(conversationId)
      .then((loaded) => !cancelled && apply(loaded))
      .catch((e: Error) => console.warn('Loading chat settings failed:', e.message));

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` },
        (payload) => apply(payload.new as ConversationSettings),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, expire]);

  // Tick while any message is counting down, and burn the ones that are due.
  const hasCountdown = useMemo(
    () => messages.some((m) => !expiredRef.current.has(m.id) && burnsAt(m) !== null),
    [messages, expiredIds],
  );

  useEffect(() => {
    if (!hasCountdown) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [hasCountdown]);

  useEffect(() => {
    const due = messages.filter((m) => {
      const at = burnsAt(m);
      return at !== null && at <= now && !expiredRef.current.has(m.id);
    });
    if (due.length === 0) return;
    expire(due.map((m) => m.id));
    // Give the server a moment so small clock differences don't leave the
    // row behind.
    setTimeout(sweepServer, 1500);
  }, [messages, now, expire, sweepServer]);

  // Read receipts: while this chat is open in the foreground, mark the other
  // person's messages read. Legacy plaintext messages can't carry receipts.
  const appState = useAppState();
  const hasUnread = useMemo(
    () => messages.some((m) => m.sender_id !== userId && m.read_at === null && m.ciphertext !== null),
    [messages, userId],
  );

  useEffect(() => {
    if (!userId || !hasUnread || appState !== 'active') return;

    markConversationRead(conversationId)
      .then(() => {
        // Apply locally too, so a later message re-triggers this effect even
        // if the realtime UPDATE for these rows is slow to arrive.
        const now = new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) =>
            m.sender_id !== userId && m.read_at === null && m.ciphertext !== null
              ? { ...m, read_at: now, delivered_at: m.delivered_at ?? now }
              : m,
          ),
        );
      })
      .catch((e: Error) => console.warn('Marking conversation read failed:', e.message));
  }, [conversationId, userId, hasUnread, appState]);

  const displayMessages = useMemo<DisplayMessage[]>(
    () =>
      messages.map((m) => {
        const due = burnsAt(m);
        return {
          ...m,
          ...openContent(m, sharedKey),
          isExpired: expiredIds.has(m.id),
          burnIn: due === null ? null : Math.max(0, Math.ceil((due - now) / 1000)),
        };
      }),
    [messages, sharedKey, expiredIds, now],
  );

  const send = useCallback(
    async (text: string) => {
      if (!sharedKey) throw new Error('Encryption is not ready for this chat yet.');
      const message = await sendMessage(conversationId, encrypt(text, sharedKey));
      setMessages((prev) => merge([message], prev));
    },
    [conversationId, sharedKey],
  );

  const sendImage = useCallback(
    async (image: { base64: string; width: number; height: number }, viewOnce: boolean) => {
      if (!sharedKey) throw new Error('Encryption is not ready for this chat yet.');
      const { path, envelope } = await encryptAndUploadImage(conversationId, image, sharedKey);
      try {
        const message = await sendMessage(conversationId, encrypt(JSON.stringify(envelope), sharedKey), {
          attachmentPath: path,
          viewOnce,
        });
        setMessages((prev) => merge([message], prev));
      } catch (e) {
        await removeUploadedImage(path);
        throw e;
      }
    },
    [conversationId, sharedKey],
  );

  // Delete for everyone. The server wipes the content; the encrypted photo
  // file (if any) is removed from Storage afterwards.
  const deleteMessage = useCallback(async (message: Message) => {
    await deleteMessageRpc(message.id);
    forgetImage(message.id);
    const now = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? withUpdate(m, { ...m, deleted_at: now }) : m)),
    );
    if (message.attachment_path) await removeUploadedImage(message.attachment_path);
  }, []);

  const setTimer = useCallback(
    async (seconds: number | null, mode: BurnMode) => {
      const previous = settings;
      setSettings((current) => current && { ...current, burn_seconds: seconds, burn_mode: mode });
      try {
        await setBurnTimer(conversationId, seconds, mode);
      } catch (e) {
        setSettings(previous);
        throw e;
      }
    },
    [conversationId, settings],
  );

  // Erase the whole chat for both people. Everything on screen burns.
  const eraseForEveryone = useCallback(async () => {
    const paths = await eraseConversation(conversationId);
    expire(messagesRef.current.map((m) => m.id));
    await Promise.all(paths.map(removeUploadedImage));
  }, [conversationId, expire]);

  // A view-once photo was closed: record it, then destroy the file.
  const markViewed = useCallback(async (message: Message) => {
    await markMessageViewed(message.id);
    forgetImage(message.id);
    const now = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? withUpdate(m, { ...m, viewed_at: now }) : m)),
    );
    if (message.attachment_path) await removeUploadedImage(message.attachment_path);
  }, []);

  return {
    messages: displayMessages,
    peer,
    sharedKey,
    isReady: sharedKey !== null,
    error,
    send,
    sendImage,
    deleteMessage,
    markViewed,
    settings,
    setTimer,
    eraseForEveryone,
  };
}

function withUpdate(message: Message, update: Message): Message {
  const next: Message = {
    ...message,
    delivered_at: update.delivered_at,
    read_at: update.read_at,
    viewed_at: update.viewed_at,
    deleted_at: update.deleted_at,
  };
  if (update.viewed_at) next.attachment_path = null;
  if (update.deleted_at) {
    next.body = null;
    next.ciphertext = null;
    next.nonce = null;
    next.attachment_path = null;
  }
  return next;
}

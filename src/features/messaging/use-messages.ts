import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { BURN_ANIMATION_MS, burnsAt } from '@/features/burn-mode/timer';
import {
  burnExpiredMessages,
  claimAttachmentCleanup,
  deleteMessage as deleteMessageRpc,
  editMessage as editMessageRpc,
  eraseConversation,
  getConversation,
  getConversationSettings,
  getMessage,
  listMessages,
  markConversationRead,
  markMessageViewed,
  PAGE_SIZE,
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
import { noteServerTime } from '@/features/messaging/edit';
import { useAppState } from '@/hooks/use-app-state';
import { useSession } from '@/hooks/use-session';
import { encrypt, randomUuid } from '@/services/encryption/box';
import { getSharedKey } from '@/services/encryption/device-keys';
import { supabase } from '@/services/supabase/client';

export type DisplayMessage = Message &
  MessageContent & {
    // Burned by its timer or an erase: plays the burn, then disappears
    // entirely instead of leaving a "burned" placeholder.
    isExpired: boolean;
    // Seconds until it burns, once its timer has started.
    burnIn: number | null;
    // Only on your own messages that the server hasn't confirmed yet.
    sendState?: 'sending' | 'failed';
  };

// A text message shown straight away, before the server has it. Its id is
// the one it will be stored under, so retrying can't make a second copy.
type PendingMessage = {
  id: string;
  text: string;
  replyTo?: string;
  created_at: string;
  state: 'sending' | 'failed';
};

// Newest first, de-duplicated by id: a sent message can arrive both from the
// insert response and from the realtime subscription.
function merge(incoming: Message[], existing: Message[]) {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

// isVisible: the chat is actually on screen (focused, nothing covering it).
// Messages are only marked read then, so a read-mode burn timer can't start
// on messages nobody has seen.
export function useMessages(conversationId: string, { isVisible = true }: { isVisible?: boolean } = {}) {
  const { session } = useSession();
  const userId = session?.user.id;
  const [messages, setMessages] = useState<Message[]>([]);
  const [peer, setPeer] = useState<ConversationPeer | null>(null);
  const [sharedKey, setSharedKey] = useState<Uint8Array | null>(null);
  const sharedKeyRef = useRef(sharedKey);
  sharedKeyRef.current = sharedKey;
  // Setting up the chat key, and loading messages, can each fail (offline);
  // both are retried when the connection or the app comes back.
  const [keyError, setKeyError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const error = keyError ?? loadError;
  const [keyAttempt, setKeyAttempt] = useState(0);
  // View-once photos burned here whose server update hasn't gone through yet:
  // they stay burned locally (even across a resync) and are retried.
  const pendingViewed = useRef(new Map<string, string | null>());
  // Failed messages the person chose to delete while a retry was under way.
  const discarded = useRef(new Set<string>());
  // Text sends go one at a time, so they're stored in the order they were sent.
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());
  const hasLoaded = useRef(false);
  const [settings, setSettings] = useState<ConversationSettings | null>(null);
  const [expiredIds, setExpiredIds] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<PendingMessage[]>([]);
  // Live updates are flowing (false while connecting or offline).
  const [isConnected, setIsConnected] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
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
          setKeyError(`${loadedPeer.friend_code} hasn't set up encryption yet. Ask them to open Ghost.`);
          return;
        }
        const key = await getSharedKey(userId, loadedPeer.friend_public_key);
        if (cancelled) return;
        setSharedKey(key);
        setKeyError(null);
      } catch (e) {
        if (!cancelled) setKeyError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // keyAttempt: tried again after a failure, once back online or in the app.
  }, [conversationId, userId, keyAttempt]);

  const retryKeyIfNeeded = useCallback(() => {
    if (!sharedKeyRef.current) setKeyAttempt((n) => n + 1);
  }, []);

  // Burned locally but not yet on the server: keep them burned, and try again.
  const keepPendingViewed = useCallback((list: Message[]) => {
    if (pendingViewed.current.size === 0) return list;
    return list.map((m) => {
      if (!pendingViewed.current.has(m.id) || m.viewed_at) return m;
      return { ...m, viewed_at: new Date().toISOString(), attachment_path: null };
    });
  }, []);

  const flushPendingViewed = useCallback(() => {
    for (const [id, path] of pendingViewed.current) {
      markMessageViewed(id)
        .then(() => {
          pendingViewed.current.delete(id);
          if (path) removeUploadedImage(path);
        })
        .catch((e: Error) => console.warn('Burning view-once photo failed:', e.message));
    }
  }, []);

  // Refetches the chat's settings (set by refreshSettings' owner effect below).
  const refreshSettings = useRef<() => void>(() => {});

  // Fetches the latest page and merges it in: on opening, on every
  // (re)connection and when the app returns to the foreground, so nothing
  // sent or changed while offline is missed.
  const resync = useCallback(async () => {
    try {
      const loaded = await listMessages(conversationId);
      // More than a page arrived while away: page back until it meets what we
      // already have, so nothing in between goes missing.
      const newestHeld = messagesRef.current[0];
      if (hasLoaded.current && newestHeld && loaded.length === PAGE_SIZE) {
        let oldest = loaded[loaded.length - 1];
        for (let page = 0; page < 20 && Date.parse(oldest.created_at) > Date.parse(newestHeld.created_at); page++) {
          const older = await listMessages(conversationId, { before: oldest.created_at });
          loaded.push(...older);
          if (older.length < PAGE_SIZE) break;
          oldest = older[older.length - 1];
        }
      }
      const at = Date.now();
      const live = loaded.filter((m) => {
        const due = burnsAt(m);
        return due === null || due > at;
      });
      if (live.length < loaded.length) sweepServer();
      // Deleted or opened while away: drop their photos from memory.
      live.forEach((m) => (m.deleted_at || m.viewed_at) && forgetImage(m.id));
      if (!hasLoaded.current) {
        hasLoaded.current = true;
        setHasOlder(loaded.length >= PAGE_SIZE);
      }
      setLoadError(null);
      setMessages((prev) => keepPendingViewed(merge(live, prev)));
    } catch (e) {
      if (!hasLoaded.current) setLoadError((e as Error).message);
    }
  }, [conversationId, sweepServer, keepPendingViewed]);

  // Back in the app or back online: catch up on everything that may have
  // changed meanwhile (messages, an erase or timer change, a failed key setup,
  // view-once photos still to burn on the server).
  const catchUp = useCallback(() => {
    resync();
    refreshSettings.current();
    retryKeyIfNeeded();
    flushPendingViewed();
    // Photos of messages the background sweep burned: delete their files.
    claimAttachmentCleanup(conversationId)
      .then((paths) => paths.forEach(removeUploadedImage))
      .catch(() => {});
  }, [conversationId, resync, retryKeyIfNeeded, flushPendingViewed]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    return () => subscription.remove();
  }, [catchUp]);

  useEffect(() => {
    resync();

    const filter = `conversation_id=eq.${conversationId}`;
    const insert = (payload: { new: object }) =>
      setMessages((prev) => merge([payload.new as Message], prev));
    // Only take the columns an UPDATE can change: receipts, view-once,
    // deletion and edits. Postgres leaves unchanged TOASTed (large) values out
    // of the change feed, so a long message's ciphertext arrives missing and
    // must not overwrite what we have.
    const applyUpdate = (payload: { new: object }) => {
      const update = payload.new as Message;
      if (update.deleted_at || update.viewed_at) forgetImage(update.id);
      setMessages((prev) =>
        prev.map((m) => (m.id === update.id ? withUpdate(m, update) : m)),
      );
      // An edit whose new text didn't come with the change: fetch it.
      const known = messagesRef.current.find((m) => m.id === update.id);
      if (known && !update.deleted_at && isNewerEdit(update, known) && !(update.ciphertext && update.nonce)) {
        getMessage(update.id)
          .then((fresh) => fresh && setMessages((prev) => merge([fresh], prev)))
          .catch((e: Error) => console.warn('Loading edited message failed:', e.message));
      }
    };

    // INSERT: new messages. UPDATE: receipts, opened view-once photos, deletions.
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, insert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, applyUpdate)
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        // Back after a drop: pick up whatever arrived in the gap.
        if (status === 'SUBSCRIBED') catchUp();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, resync, catchUp]);

  // Older messages, a page at a time, as the person scrolls up.
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current.at(-1);
    if (!hasOlder || isLoadingOlder || !oldest) return;
    setIsLoadingOlder(true);
    try {
      const older = await listMessages(conversationId, { before: oldest.created_at });
      setHasOlder(older.length === PAGE_SIZE);
      setMessages((prev) => merge(older, prev));
    } catch (e) {
      console.warn('Loading older messages failed:', (e as Error).message);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [conversationId, hasOlder, isLoadingOlder]);

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

    const load = () =>
      getConversationSettings(conversationId)
        .then((loaded) => !cancelled && apply(loaded))
        .catch((e: Error) => console.warn('Loading chat settings failed:', e.message));
    load();
    // An erase or timer change made while this phone was away is picked up
    // when it catches up, not only from the live feed.
    refreshSettings.current = load;

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
      refreshSettings.current = () => {};
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
    if (!userId || !hasUnread || appState !== 'active' || !isVisible) return;

    // Only the messages that were here when asking: one arriving meanwhile is
    // still unread on the server, so it mustn't look read (and burn) here.
    const asked = new Set(
      messagesRef.current
        .filter((m) => m.sender_id !== userId && m.read_at === null && m.ciphertext !== null)
        .map((m) => m.id),
    );
    markConversationRead(conversationId)
      .then(() => {
        // Apply locally too, so a later message re-triggers this effect even
        // if the realtime UPDATE for these rows is slow to arrive.
        const now = new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) =>
            asked.has(m.id) && m.read_at === null ? { ...m, read_at: now, delivered_at: m.delivered_at ?? now } : m,
          ),
        );
      })
      .catch((e: Error) => console.warn('Marking conversation read failed:', e.message));
    // isConnected: a failed attempt is retried once back online.
  }, [conversationId, userId, hasUnread, appState, isVisible, isConnected]);

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const stored = new Set(messages.map((m) => m.id));
    // Newest first, like `messages`; pending ones are the newest of all.
    const unsent: DisplayMessage[] = pending
      .filter((p) => !stored.has(p.id))
      .reverse()
      .map((p) => ({
        id: p.id,
        conversation_id: conversationId,
        sender_id: userId ?? '',
        body: null,
        ciphertext: null,
        nonce: null,
        created_at: p.created_at,
        delivered_at: null,
        read_at: null,
        kind: 'text',
        attachment_path: null,
        view_once: false,
        viewed_at: null,
        deleted_at: null,
        burn_seconds: null,
        burn_mode: null,
        reply_to: p.replyTo ?? null,
        edited_at: null,
        text: p.text,
        image: null,
        isEncrypted: true,
        isDeleted: false,
        isExpired: false,
        burnIn: null,
        sendState: p.state,
      }));
    return [
      ...unsent,
      ...messages.map((m) => {
        const due = burnsAt(m);
        return {
          ...m,
          ...openContent(m, sharedKey),
          isExpired: expiredIds.has(m.id),
          burnIn: due === null ? null : Math.max(0, Math.ceil((due - now) / 1000)),
        };
      }),
    ];
  }, [messages, pending, sharedKey, expiredIds, now, conversationId, userId]);

  const deliver = useCallback(
    // isFirstAttempt: a retry can get back the copy an earlier attempt stored,
    // whose timestamp says nothing about the clocks now.
    (message: PendingMessage, isFirstAttempt = false) => {
      if (!sharedKey) return Promise.resolve();
      discarded.current.delete(message.id);
      setPending((prev) => prev.map((p) => (p.id === message.id ? { ...p, state: 'sending' } : p)));
      // One at a time, in the order they were sent: the server stamps the time
      // on arrival, so two sends racing could otherwise swap places.
      const run = sendQueue.current.then(async () => {
        try {
          const sentAt = Date.now();
          const stored = await sendMessage(
            conversationId,
            encrypt(message.text, sharedKey),
            undefined,
            message.replyTo,
            message.id,
          );
          if (isFirstAttempt) noteServerTime(stored.created_at, sentAt, Date.now());
          setPending((prev) => prev.filter((p) => p.id !== message.id));
          // Deleted by the person while this retry was under way: it went out
          // anyway, so take it back for everyone rather than show it.
          if (discarded.current.has(message.id)) {
            discarded.current.delete(message.id);
            deleteMessageRpc(stored.id).catch((e: Error) => console.warn('Withdrawing message failed:', e.message));
            return;
          }
          setMessages((prev) => merge([stored], prev));
        } catch (e) {
          console.warn('Sending failed:', (e as Error).message);
          setPending((prev) => prev.map((p) => (p.id === message.id ? { ...p, state: 'failed' } : p)));
        }
      });
      sendQueue.current = run;
      return run;
    },
    [conversationId, sharedKey],
  );

  // Shows the message at once (🕓), then stores it. A failure leaves it in
  // the chat marked as not sent, to retry or discard.
  const send = useCallback(
    (text: string, replyTo?: string) => {
      if (!sharedKey) throw new Error('Encryption is not ready for this chat yet.');
      const message: PendingMessage = {
        id: randomUuid(),
        text,
        replyTo,
        created_at: new Date().toISOString(),
        state: 'sending',
      };
      setPending((prev) => [...prev, message]);
      deliver(message, true);
    },
    [deliver, sharedKey],
  );

  const retry = useCallback(
    (id: string) => {
      const message = pending.find((p) => p.id === id);
      if (message) deliver(message);
    },
    [deliver, pending],
  );

  const discard = useCallback((id: string) => {
    // If a retry is under way it may still land; deliver withdraws it then.
    discarded.current.add(id);
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Failed sends are retried by themselves once the connection is back.
  useEffect(() => {
    if (!isConnected) return;
    pending.filter((p) => p.state === 'failed').forEach((p) => deliver(p));
    // Only when the connection comes back, not on every pending change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const sendImage = useCallback(
    async (image: { base64: string; width: number; height: number }, viewOnce: boolean) => {
      if (!sharedKey) throw new Error('Encryption is not ready for this chat yet.');
      const { path, envelope } = await encryptAndUploadImage(conversationId, image, sharedKey);
      // Chosen here so a lost reply can be checked, and a retry can't duplicate it.
      const id = randomUuid();
      try {
        const message = await sendMessage(
          conversationId,
          encrypt(JSON.stringify(envelope), sharedKey),
          { attachmentPath: path, viewOnce },
          undefined,
          id,
        );
        setMessages((prev) => merge([message], prev));
      } catch (e) {
        // The message may have been stored even though the reply was lost:
        // then its photo must stay.
        const stored = await getMessage(id).catch(() => null);
        if (stored) {
          setMessages((prev) => merge([stored], prev));
          return;
        }
        await removeUploadedImage(path);
        throw e;
      }
    },
    [conversationId, sharedKey],
  );

  // Edits one of your text messages (within 5 minutes of sending). The new
  // text shows at once and is put back if the server refuses.
  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!sharedKey) throw new Error('Encryption is not ready for this chat yet.');
      const original = messagesRef.current.find((m) => m.id === messageId);
      if (!original) throw new Error('Message not found');
      const encrypted = encrypt(text, sharedKey);
      const edited: Message = { ...original, ...encrypted, edited_at: new Date().toISOString() };
      setMessages((prev) => prev.map((m) => (m.id === messageId ? edited : m)));
      try {
        const editedAt = await editMessageRpc(messageId, encrypted);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.ciphertext === encrypted.ciphertext ? { ...m, edited_at: editedAt } : m,
          ),
        );
      } catch (e) {
        // The edit may have been saved even though the reply was lost (a
        // dropped connection): ask the server what it has before undoing.
        const stored = await getMessage(messageId).catch(() => null);
        if (stored?.ciphertext === encrypted.ciphertext) {
          setMessages((prev) => merge([stored], prev));
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.ciphertext === encrypted.ciphertext
              ? stored
                ? { ...m, ciphertext: stored.ciphertext, nonce: stored.nonce, edited_at: stored.edited_at }
                : { ...m, ciphertext: original.ciphertext, nonce: original.nonce, edited_at: original.edited_at }
              : m,
          ),
        );
        throw e;
      }
    },
    [sharedKey],
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
  // Burned here first, so it can't be reopened even if the server can't be
  // reached; the server update (and file removal) is retried until it lands.
  const markViewed = useCallback(
    async (message: Message) => {
      forgetImage(message.id);
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? withUpdate(m, { ...m, viewed_at: now }) : m)),
      );
      pendingViewed.current.set(message.id, message.attachment_path);
      flushPendingViewed();
    },
    [flushPendingViewed],
  );

  return {
    messages: displayMessages,
    peer,
    sharedKey,
    isReady: sharedKey !== null,
    isConnected,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    error,
    send,
    retry,
    discard,
    sendImage,
    editMessage,
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
  // Edited: take the new text when the change carries it (otherwise the
  // caller fetches the message).
  if (isNewerEdit(update, message) && update.ciphertext && update.nonce) {
    next.ciphertext = update.ciphertext;
    next.nonce = update.nonce;
    next.edited_at = update.edited_at;
  }
  if (update.deleted_at) {
    next.body = null;
    next.ciphertext = null;
    next.nonce = null;
    next.attachment_path = null;
  }
  return next;
}

// The update carries a later edit than the one we have. Missing edited_at
// (before the message-edits migration) never counts.
function isNewerEdit(update: Message, message: Message) {
  if (!update.edited_at) return false;
  if (!message.edited_at) return true;
  return Date.parse(update.edited_at) > Date.parse(message.edited_at);
}

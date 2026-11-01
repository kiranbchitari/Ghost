import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppState } from '@/hooks/use-app-state';
import { supabase } from '@/services/supabase/client';

// While typing, say so again this often, so the other phone's indicator
// (which fades on its own) stays up.
const REPEAT_MS = 2500;
// Stop after this long without a keystroke.
const IDLE_MS = 4000;
// The other phone's indicator fades if nothing refreshes it (e.g. they lost
// their connection mid-sentence).
const PEER_TIMEOUT_MS = 6000;
// The chat list listens to this many of the most recent chats; Realtime caps
// the channels one connection may join.
export const MAX_LISTENED_CHATS = 40;
// An unused channel is kept this long before it's removed. The client hands
// back a channel that is still closing if its topic is joined again, so a
// quick return (reopening a chat, the list reloading) reuses it instead.
const LINGER_MS = 3000;

// Live "typing…", like WhatsApp. Nothing is stored: each chat has a private
// Realtime broadcast channel that only its two members can join (see
// supabase/migrations/20261031200000_typing_indicators.sql). Without that
// migration the channel can't be joined and nothing is shown.
//
// The open chat and the chat list both listen to the same chats, and the
// Supabase client hands out one channel per topic, so channels are shared
// here and only removed once nobody uses them.
type Room = {
  channel: RealtimeChannel;
  users: number;
  isJoined: boolean;
  isPeerTyping: boolean;
  peerTimer: ReturnType<typeof setTimeout> | undefined;
  closeTimer: ReturnType<typeof setTimeout> | undefined;
  listeners: Set<() => void>;
};

const rooms = new Map<string, Room>();

function setPeerTyping(room: Room, typing: boolean) {
  clearTimeout(room.peerTimer);
  if (typing) room.peerTimer = setTimeout(() => setPeerTyping(room, false), PEER_TIMEOUT_MS);
  if (room.isPeerTyping === typing) return;
  room.isPeerTyping = typing;
  for (const listener of room.listeners) listener();
}

// Joins a chat's typing channel; the returned function leaves it.
function joinRoom(conversationId: string, listener: () => void) {
  let room = rooms.get(conversationId);
  if (!room) {
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    const created: Room = {
      channel,
      users: 0,
      isJoined: false,
      isPeerTyping: false,
      peerTimer: undefined,
      closeTimer: undefined,
      listeners: new Set(),
    };
    room = created;
    rooms.set(conversationId, created);
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        setPeerTyping(created, !!(payload as { typing?: unknown } | undefined)?.typing);
      })
      .subscribe((status) => {
        created.isJoined = status === 'SUBSCRIBED';
        if (!created.isJoined) setPeerTyping(created, false);
      });
  }
  const joined = room;
  clearTimeout(joined.closeTimer);
  joined.users++;
  joined.listeners.add(listener);
  let hasLeft = false;
  return () => {
    if (hasLeft) return;
    hasLeft = true;
    joined.listeners.delete(listener);
    if (--joined.users > 0) return;
    joined.closeTimer = setTimeout(() => {
      clearTimeout(joined.peerTimer);
      rooms.delete(conversationId);
      supabase.removeChannel(joined.channel);
    }, LINGER_MS);
  };
}

function sendTyping(conversationId: string, typing: boolean) {
  const room = rooms.get(conversationId);
  if (!room?.isJoined) return;
  room.channel.send({ type: 'broadcast', event: 'typing', payload: { typing } }).catch(() => {});
}

// Typing in one open chat: whether the other person is, and the composer's side.
export function useTyping(conversationId: string, userId: string | undefined) {
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const isTyping = useRef(false);
  const lastSent = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopTyping = useCallback(() => {
    clearTimeout(idleTimer.current);
    if (!isTyping.current) return;
    isTyping.current = false;
    sendTyping(conversationId, false);
  }, [conversationId]);

  // Call on every change to the composer's text.
  const onDraftChange = useCallback(
    (text: string) => {
      if (!text.trim()) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (!isTyping.current || now - lastSent.current > REPEAT_MS) {
        isTyping.current = true;
        lastSent.current = now;
        sendTyping(conversationId, true);
      }
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(stopTyping, IDLE_MS);
    },
    [conversationId, stopTyping],
  );

  useEffect(() => {
    if (!userId) return;
    const update = () => setIsPeerTyping(!!rooms.get(conversationId)?.isPeerTyping);
    const leave = joinRoom(conversationId, update);
    update();
    return () => {
      // Let the other phone know straight away rather than waiting for its timeout.
      if (isTyping.current) sendTyping(conversationId, false);
      isTyping.current = false;
      clearTimeout(idleTimer.current);
      setIsPeerTyping(false);
      leave();
    };
  }, [conversationId, userId]);

  // Leaving the app stops typing.
  const appState = useAppState();
  useEffect(() => {
    if (appState !== 'active') stopTyping();
  }, [appState, stopTyping]);

  return { isPeerTyping, onDraftChange, stopTyping };
}

// Which of these chats someone is typing in, for the chat list. Pass the
// chats newest first; only the first MAX_LISTENED_CHATS are listened to.
export function useTypingChats(conversationIds: string[], userId: string | undefined) {
  const [typing, setTyping] = useState<ReadonlySet<string>>(() => new Set());
  // The list reloads often with the same chats; only a different set rejoins.
  const ids = conversationIds.slice(0, MAX_LISTENED_CHATS).join(',');

  useEffect(() => {
    if (!userId || !ids) return;
    const listened = ids.split(',');
    const update = () => {
      const next = new Set(listened.filter((id) => rooms.get(id)?.isPeerTyping));
      setTyping((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
    };
    const leaves = listened.map((id) => joinRoom(id, update));
    update();
    return () => {
      for (const leave of leaves) leave();
      setTyping(new Set());
    };
  }, [ids, userId]);

  return typing;
}

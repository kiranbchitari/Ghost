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

// Live "typing…" for one chat, like WhatsApp. Nothing is stored: each chat has
// a private Realtime broadcast channel that only its two members can join
// (see supabase/migrations/20261031200000_typing_indicators.sql). Without
// that migration the channel can't be joined and nothing is shown.
export function useTyping(conversationId: string, userId: string | undefined) {
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isJoined = useRef(false);
  const isTyping = useRef(false);
  const lastSent = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const broadcast = useCallback((typing: boolean) => {
    const channel = channelRef.current;
    if (!channel || !isJoined.current) return;
    channel.send({ type: 'broadcast', event: 'typing', payload: { typing } }).catch(() => {});
  }, []);

  const stopTyping = useCallback(() => {
    clearTimeout(idleTimer.current);
    if (!isTyping.current) return;
    isTyping.current = false;
    broadcast(false);
  }, [broadcast]);

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
        broadcast(true);
      }
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(stopTyping, IDLE_MS);
    },
    [broadcast, stopTyping],
  );

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`typing:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        clearTimeout(peerTimer.current);
        const typing = !!(payload as { typing?: unknown } | undefined)?.typing;
        setIsPeerTyping(typing);
        if (typing) peerTimer.current = setTimeout(() => setIsPeerTyping(false), PEER_TIMEOUT_MS);
      })
      .subscribe((status) => {
        isJoined.current = status === 'SUBSCRIBED';
        if (!isJoined.current) setIsPeerTyping(false);
      });
    channelRef.current = channel;

    return () => {
      // Let the other phone know straight away rather than waiting for its timeout.
      if (isTyping.current && isJoined.current) {
        channel.send({ type: 'broadcast', event: 'typing', payload: { typing: false } }).catch(() => {});
      }
      isTyping.current = false;
      isJoined.current = false;
      channelRef.current = null;
      clearTimeout(idleTimer.current);
      clearTimeout(peerTimer.current);
      setIsPeerTyping(false);
      supabase.removeChannel(channel);
    };
  }, [conversationId, userId]);

  // Leaving the app stops typing.
  const appState = useAppState();
  useEffect(() => {
    if (appState !== 'active') stopTyping();
  }, [appState, stopTyping]);

  return { isPeerTyping, onDraftChange, stopTyping };
}

import { useEffect } from 'react';

import { markMessagesDelivered, type Message } from '@/features/messaging/api';
import { useAppState } from '@/hooks/use-app-state';
import { supabase } from '@/services/supabase/client';

// Marks incoming messages as delivered (the second grey tick) whenever the app
// is in the foreground: on launch, on returning to the app, and as messages
// arrive. With no push notifications yet, a closed app can't acknowledge
// anything until it's opened again.
export function useDeliveryReceipts(userId: string | undefined) {
  const appState = useAppState();
  const isActive = appState === 'active';

  useEffect(() => {
    if (!userId || !isActive) return;

    const markDelivered = () =>
      markMessagesDelivered().catch((e: Error) =>
        console.warn('Marking messages delivered failed:', e.message),
      );

    markDelivered();

    const channel = supabase
      .channel('delivery-receipts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if ((payload.new as Message).sender_id !== userId) markDelivered();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, isActive]);
}

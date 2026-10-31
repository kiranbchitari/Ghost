import { maskText } from '@/features/messaging/mask';
import type { DisplayMessage } from '@/features/messaging/use-messages';

// What a reply shows of the message it quotes. Built on each phone from its own
// decrypted copy; the server only stores the quoted message's id.
export type Quote = {
  // null when the quoted message isn't on this phone (too old, or burned away).
  targetId: string | null;
  author: string;
  text: string;
};

export function describeForQuote(message: DisplayMessage, mask: boolean) {
  if (message.isDeleted || message.isExpired) return '🔥 Message burned';
  if (message.kind === 'image') return message.view_once ? '◎ View-once photo' : '📷 Photo';
  if (message.text === null) return "Couldn't decrypt this message";
  return mask ? maskText(message.text) : message.text;
}

export function quoteFor(
  message: DisplayMessage,
  byId: ReadonlyMap<string, DisplayMessage>,
  myId: string | undefined,
  friendName: string,
  mask: boolean,
): Quote | null {
  if (!message.reply_to) return null;
  const target = byId.get(message.reply_to);
  if (!target) return { targetId: null, author: '', text: 'Original message unavailable' };
  return {
    targetId: target.id,
    author: target.sender_id === myId ? 'You' : friendName,
    text: describeForQuote(target, mask),
  };
}

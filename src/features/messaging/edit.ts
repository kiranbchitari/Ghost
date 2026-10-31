import type { DisplayMessage } from '@/features/messaging/use-messages';

// Messages can be edited for 5 minutes after sending. The server enforces the
// same window (with a little grace for network lag) in edit_message().
export const EDIT_WINDOW_MS = 5 * 60 * 1000;

// Your own text messages that are stored, readable and still in the window.
export function canEdit(message: DisplayMessage, myId: string | undefined, now = Date.now()) {
  return (
    !!myId &&
    message.sender_id === myId &&
    message.kind === 'text' &&
    message.ciphertext !== null &&
    message.text !== null &&
    !message.isDeleted &&
    !message.isExpired &&
    !message.sendState &&
    now - Date.parse(message.created_at) < EDIT_WINDOW_MS
  );
}

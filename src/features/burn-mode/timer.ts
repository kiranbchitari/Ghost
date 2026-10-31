import type { BurnMode, Message } from '@/features/messaging/api';

export const BURN_OPTIONS: { seconds: number | null; label: string }[] = [
  { seconds: null, label: 'Off' },
  { seconds: 5, label: '5s' },
  { seconds: 10, label: '10s' },
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1 min' },
  { seconds: 3600, label: '1 hour' },
];

// How long a burning bubble animates before it's removed from the list.
// Matches BurnEffect's start delay + duration, with a little slack.
export const BURN_ANIMATION_MS = 2400;

export function formatBurn(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function describeBurn(seconds: number | null, mode: BurnMode) {
  if (seconds === null) return null;
  return `Messages burn ${formatBurn(seconds)} after ${mode === 'read' ? 'they are read' : 'sending'}`;
}

// When a message burns, or null if it has no timer or (read mode) hasn't
// been read yet. Mirrors public.message_burns_at in the database.
export function burnsAt(message: Pick<Message, 'burn_seconds' | 'burn_mode' | 'created_at' | 'read_at'>) {
  if (message.burn_seconds === null || message.burn_mode === null) return null;
  const start = message.burn_mode === 'sent' ? message.created_at : message.read_at;
  return start ? Date.parse(start) + message.burn_seconds * 1000 : null;
}

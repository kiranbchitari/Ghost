import type { Encrypted } from '@/services/encryption/box';
import { supabase } from '@/services/supabase/client';

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  // Only set on messages sent before end-to-end encryption.
  body: string | null;
  ciphertext: string | null;
  nonce: string | null;
  created_at: string;
  // Receipts, set by the recipient's app.
  delivered_at: string | null;
  read_at: string | null;
  kind: 'text' | 'image';
  // Encrypted photo in the attachments bucket; null once deleted or viewed.
  attachment_path: string | null;
  view_once: boolean;
  viewed_at: string | null;
  // Deleted for everyone: content is wiped server-side.
  deleted_at: string | null;
  // Disappearing-message timer copied from the conversation when sent.
  burn_seconds: number | null;
  burn_mode: BurnMode | null;
  // The message this one replies to (same chat); null if not a reply, or once
  // the quoted message is gone.
  reply_to: string | null;
};

export type BurnMode = 'read' | 'sent';

export type ConversationSettings = {
  burn_seconds: number | null;
  burn_mode: BurnMode;
  cleared_at: string | null;
};

export type ConversationSummary = {
  conversation_id: string;
  friend_code: string;
  friend_public_key: string | null;
  friend_avatar: string | null;
  last_body: string | null;
  last_ciphertext: string | null;
  last_nonce: string | null;
  last_kind: 'text' | 'image' | null;
  last_deleted: boolean | null;
  last_message_at: string;
  // Messages from the friend not yet read here. Missing before the
  // unread-counts migration; treat as 0.
  unread_count?: number;
};

export type ConversationPeer = {
  friend_code: string;
  friend_public_key: string | null;
  friend_avatar: string | null;
};

export type MyProfile = { ghost_code: string; avatar: string | null };

export async function getMyProfile() {
  // RLS only returns the caller's own profile.
  const { data, error } = await supabase.from('profiles').select('ghost_code, avatar').single();
  if (error) throw new Error(error.message);
  return data as MyProfile;
}

// null switches back to the automatic hero.
export async function setAvatar(avatar: string | null) {
  const { error } = await supabase.rpc('set_avatar', { p_avatar: avatar });
  if (error) throw new Error(error.message);
}

export async function startConversation(friendCode: string) {
  const { data, error } = await supabase.rpc('start_conversation', { friend_code: friendCode });
  if (error) throw new Error(error.message);
  // null (not an error) so the server can count wrong codes.
  if (!data) throw new Error('No Ghost found with that code');
  return data as string;
}

export async function getConversation(conversationId: string) {
  const { data, error } = await supabase
    .rpc('get_conversation', { p_conversation_id: conversationId })
    .single();
  if (error) throw new Error(error.message);
  return data as ConversationPeer;
}

export async function listConversations() {
  const { data, error } = await supabase.rpc('list_conversations');
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationSummary[];
}

export async function listMessages(conversationId: string, limit = 100) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data as Message[];
}

export async function markMessagesDelivered() {
  const { error } = await supabase.rpc('mark_messages_delivered');
  if (error) throw new Error(error.message);
}

export async function markConversationRead(conversationId: string) {
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message);
}

export async function sendMessage(
  conversationId: string,
  { ciphertext, nonce }: Encrypted,
  image?: { attachmentPath: string; viewOnce: boolean },
  replyTo?: string,
) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      ciphertext,
      nonce,
      ...(image && { kind: 'image', attachment_path: image.attachmentPath, view_once: image.viewOnce }),
      ...(replyTo && { reply_to: replyTo }),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Message;
}

export async function deleteMessage(messageId: string) {
  const { error } = await supabase.rpc('delete_message', { p_message_id: messageId });
  if (error) throw new Error(error.message);
}

export async function markMessageViewed(messageId: string) {
  const { error } = await supabase.rpc('mark_message_viewed', { p_message_id: messageId });
  if (error) throw new Error(error.message);
}

// Attachments are stored as base64 text of the ciphertext: React Native's
// fetch reliably reads text, while binary response bodies are patchy.
const ATTACHMENTS = 'attachments';

export async function uploadAttachment(path: string, ciphertextBase64: string) {
  const { error } = await supabase.storage
    .from(ATTACHMENTS)
    .upload(path, ciphertextBase64, { contentType: 'text/plain', upsert: false });
  if (error) throw new Error(error.message);
}

export async function downloadAttachment(path: string) {
  const { data, error } = await supabase.storage.from(ATTACHMENTS).createSignedUrl(path, 60);
  if (error) throw new Error(error.message);
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error(`Photo download failed (${response.status})`);
  return response.text();
}

export async function deleteAttachment(path: string) {
  const { error } = await supabase.storage.from(ATTACHMENTS).remove([path]);
  if (error) throw new Error(error.message);
}

export async function getConversationSettings(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('burn_seconds, burn_mode, cleared_at')
    .eq('id', conversationId)
    .single();
  if (error) throw new Error(error.message);
  return data as ConversationSettings;
}

// seconds = null turns disappearing messages off.
export async function setBurnTimer(conversationId: string, seconds: number | null, mode: BurnMode) {
  const { error } = await supabase.rpc('set_burn_timer', {
    p_conversation_id: conversationId,
    p_seconds: seconds,
    p_mode: mode,
  });
  if (error) throw new Error(error.message);
}

// Both return the attachment paths of the deleted messages, so their
// encrypted files can be removed from Storage.
export async function burnExpiredMessages(conversationId: string) {
  const { data, error } = await supabase.rpc('burn_expired_messages', {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (string | null)[]).filter((path): path is string => !!path);
}

export async function eraseConversation(conversationId: string) {
  const { data, error } = await supabase.rpc('erase_conversation', {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (string | null)[]).filter((path): path is string => !!path);
}

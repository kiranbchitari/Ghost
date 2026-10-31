-- Delivery and read receipts (WhatsApp-style ticks).
-- Only the recipient can set these, and only through the RPCs below; each
-- timestamp is set once and never overwritten.

alter table public.messages
  add column delivered_at timestamptz,
  add column read_at timestamptz;

create index messages_undelivered_idx
  on public.messages (conversation_id)
  where delivered_at is null;

-- Marks every message addressed to the caller as delivered. Called when the
-- app is open and receives (or catches up on) messages.
-- Plaintext messages from before end-to-end encryption are skipped: updating
-- them would trip the messages_must_be_encrypted check.
create function public.mark_messages_delivered()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages m
  set delivered_at = now()
  from public.conversation_members cm
  where cm.user_id = (select auth.uid())
    and m.conversation_id = cm.conversation_id
    and m.sender_id <> cm.user_id
    and m.delivered_at is null
    and m.ciphertext is not null;
$$;

-- Marks the other person's messages in one conversation as read (and
-- delivered, if that hadn't been recorded yet).
create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages m
  set read_at = now(),
      delivered_at = coalesce(m.delivered_at, now())
  where m.conversation_id = p_conversation_id
    and m.sender_id <> (select auth.uid())
    and m.read_at is null
    and m.ciphertext is not null
    and public.is_conversation_member(p_conversation_id);
$$;

revoke execute on function public.mark_messages_delivered() from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_messages_delivered() to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

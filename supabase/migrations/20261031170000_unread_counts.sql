-- Unread counts for the chat list, like WhatsApp's badges: messages from the
-- other person that this user hasn't read yet. Legacy plaintext messages are
-- left out, as mark_conversation_read() never marks them read.

-- Counting only touches unread rows, which are few.
create index messages_unread_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null and deleted_at is null;

drop function public.list_conversations();

create function public.list_conversations()
returns table (
  conversation_id uuid,
  friend_code text,
  friend_public_key text,
  friend_avatar text,
  last_body text,
  last_ciphertext text,
  last_nonce text,
  last_kind text,
  last_deleted boolean,
  last_message_at timestamptz,
  unread_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    p.ghost_code,
    p.public_key,
    p.avatar,
    lm.body,
    lm.ciphertext,
    lm.nonce,
    lm.kind,
    lm.deleted_at is not null,
    coalesce(lm.created_at, c.created_at),
    (
      select count(*)::integer
      from public.messages u
      where u.conversation_id = c.id
        and u.sender_id = other.user_id
        and u.read_at is null
        and u.deleted_at is null
        and u.ciphertext is not null
    )
  from public.conversation_members mine
  join public.conversations c on c.id = mine.conversation_id
  join public.conversation_members other
    on other.conversation_id = c.id and other.user_id <> mine.user_id
  join public.profiles p on p.id = other.user_id
  left join lateral (
    select m.body, m.ciphertext, m.nonce, m.kind, m.deleted_at, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where mine.user_id = (select auth.uid())
  order by 10 desc;
$$;

revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.list_conversations() to authenticated;

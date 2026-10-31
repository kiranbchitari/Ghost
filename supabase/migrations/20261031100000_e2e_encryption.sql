-- End-to-end encrypted messages.
-- Clients encrypt with NaCl box (X25519 + XSalsa20-Poly1305). The server only
-- stores each user's public key and message ciphertext; private keys never
-- leave the device.

-- Base64 of a 32-byte X25519 public key.
alter table public.profiles
  add column public_key text check (char_length(public_key) = 44);

alter table public.messages
  alter column body drop not null,
  add column ciphertext text check (char_length(ciphertext) <= 30000),
  -- Base64 of a 24-byte nonce.
  add column nonce text check (char_length(nonce) = 32);

-- Every new message must be encrypted. NOT VALID skips the check for rows
-- that already exist, so plaintext sent before this migration is kept.
alter table public.messages
  add constraint messages_must_be_encrypted
  check (body is null and ciphertext is not null and nonce is not null)
  not valid;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.set_public_key(p_public_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.profiles set public_key = p_public_key where id = auth.uid();
end;
$$;

-- The other member of a conversation the caller belongs to.
create function public.get_conversation(p_conversation_id uuid)
returns table (friend_code text, friend_public_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.ghost_code, p.public_key
  from public.conversation_members other
  join public.profiles p on p.id = other.user_id
  where other.conversation_id = p_conversation_id
    and other.user_id <> (select auth.uid())
    and public.is_conversation_member(p_conversation_id);
$$;

-- Same as before, but returns the friend's public key and the encrypted
-- last message so the client can decrypt the preview.
drop function public.list_conversations();

create function public.list_conversations()
returns table (
  conversation_id uuid,
  friend_code text,
  friend_public_key text,
  last_body text,
  last_ciphertext text,
  last_nonce text,
  last_message_at timestamptz
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
    lm.body,
    lm.ciphertext,
    lm.nonce,
    coalesce(lm.created_at, c.created_at)
  from public.conversation_members mine
  join public.conversations c on c.id = mine.conversation_id
  join public.conversation_members other
    on other.conversation_id = c.id and other.user_id <> mine.user_id
  join public.profiles p on p.id = other.user_id
  left join lateral (
    select m.body, m.ciphertext, m.nonce, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where mine.user_id = (select auth.uid())
  order by 7 desc;
$$;

revoke execute on function public.set_public_key(text) from public, anon;
revoke execute on function public.get_conversation(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.set_public_key(text) to authenticated;
grant execute on function public.get_conversation(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;

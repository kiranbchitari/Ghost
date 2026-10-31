-- Hero avatars. null means "auto": the app picks one from the Ghost code.

alter table public.profiles
  add column avatar text check (avatar ~ '^[a-z0-9-]{1,40}$');

create function public.set_avatar(p_avatar text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.profiles set avatar = p_avatar where id = auth.uid();
end;
$$;

-- Same as before, plus the friend's avatar.
drop function public.get_conversation(uuid);

create function public.get_conversation(p_conversation_id uuid)
returns table (friend_code text, friend_public_key text, friend_avatar text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.ghost_code, p.public_key, p.avatar
  from public.conversation_members other
  join public.profiles p on p.id = other.user_id
  where other.conversation_id = p_conversation_id
    and other.user_id <> (select auth.uid())
    and public.is_conversation_member(p_conversation_id);
$$;

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
    p.avatar,
    lm.body,
    lm.ciphertext,
    lm.nonce,
    lm.kind,
    lm.deleted_at is not null,
    coalesce(lm.created_at, c.created_at)
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

revoke execute on function public.set_avatar(text) from public, anon;
revoke execute on function public.get_conversation(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.set_avatar(text) to authenticated;
grant execute on function public.get_conversation(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;

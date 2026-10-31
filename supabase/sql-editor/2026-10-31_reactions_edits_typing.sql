-- Reactions, message edits and typing indicators, in one script for the
-- Supabase dashboard: SQL Editor → New query → paste all of this → Run.
--
-- Same end result as these migrations, in this order:
--   supabase/migrations/20261031180000_reactions.sql
--   supabase/migrations/20261031190000_message_edits.sql
--   supabase/migrations/20261031200000_typing_indicators.sql
--   supabase/migrations/20261031210000_burn_checks.sql
-- The migrations are the source of truth: change them first, then this copy.
--
-- Safe to run more than once. It assumes the earlier migrations (messaging
-- through unread counts) are already applied.
--
-- If you later switch to `supabase db push`, first mark these three as applied
-- so the CLI doesn't run them again:
--   npx supabase migration repair --status applied 20261031180000 20261031190000 20261031200000 20261031210000

begin;

-- ===========================================================================
-- 1. Reactions
-- ===========================================================================
-- Each member can put one emoji on any message in their chat. The emoji is
-- encrypted on the device with the chat's shared key, so the server only ever
-- sees ciphertext. Removing a reaction clears its ciphertext (an UPDATE, which
-- reaches the other phone through Realtime) rather than deleting the row.

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Encrypted emoji; both null once the reaction is removed.
  ciphertext text check (char_length(ciphertext) <= 200),
  -- Base64 of a 24-byte nonce.
  nonce text check (char_length(nonce) = 32),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint message_reactions_ciphertext_with_nonce check ((ciphertext is null) = (nonce is null))
);

create index if not exists message_reactions_conversation_id_idx
  on public.message_reactions (conversation_id);

alter table public.message_reactions enable row level security;

-- Reading only: reactions are written through set_reaction().
drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions"
  on public.message_reactions for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- Sets (or, with nulls, removes) the caller's reaction to a message.
create or replace function public.set_reaction(p_message_id uuid, p_ciphertext text, p_nonce text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  convo uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select m.conversation_id into convo
  from public.messages m
  where m.id = p_message_id
    and m.deleted_at is null
    -- Burned means gone, even before the sweep deletes it.
    and coalesce(public.message_burns_at(m) > now(), true);

  if convo is null or not public.is_conversation_member(convo) then
    raise exception 'Message not found';
  end if;

  insert into public.message_reactions (message_id, conversation_id, user_id, ciphertext, nonce, updated_at)
  values (p_message_id, convo, auth.uid(), p_ciphertext, p_nonce, now())
  on conflict (message_id, user_id) do update
  set ciphertext = excluded.ciphertext,
      nonce = excluded.nonce,
      updated_at = now();
end;
$$;

-- A message deleted for everyone loses its reactions too.
create or replace function public.drop_reactions_of_deleted_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.message_reactions r where r.message_id = new.id;
  return new;
end;
$$;

drop trigger if exists messages_drop_reactions_when_deleted on public.messages;
create trigger messages_drop_reactions_when_deleted
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.drop_reactions_of_deleted_message();

revoke execute on function public.set_reaction(uuid, text, text) from public, anon;
revoke execute on function public.drop_reactions_of_deleted_message() from public, anon, authenticated;
grant execute on function public.set_reaction(uuid, text, text) to authenticated;

-- Reactions reach the other phone live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;

-- ===========================================================================
-- 2. Message edits (5 minutes)
-- ===========================================================================

alter table public.messages
  add column if not exists edited_at timestamptz;

-- Only the sender, only text messages that are still there, and only within
-- 5 minutes (plus 30 seconds of grace for network lag).
create or replace function public.edit_message(p_message_id uuid, p_ciphertext text, p_nonce text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  stamp timestamptz;
begin
  if p_ciphertext is null or p_nonce is null then
    raise exception 'Edited messages must be encrypted';
  end if;

  update public.messages m
  set ciphertext = p_ciphertext,
      nonce = p_nonce,
      edited_at = now()
  where m.id = p_message_id
    and m.sender_id = (select auth.uid())
    and m.kind = 'text'
    and m.deleted_at is null
    and m.ciphertext is not null
    and m.created_at > now() - interval '5 minutes 30 seconds'
    and coalesce(public.message_burns_at(m) > now(), true)
  returning m.edited_at into stamp;

  if stamp is null then
    raise exception 'This message can no longer be edited';
  end if;
  return stamp;
end;
$$;

revoke execute on function public.edit_message(uuid, text, text) from public, anon;
grant execute on function public.edit_message(uuid, text, text) to authenticated;

-- ===========================================================================
-- 3. Typing indicators
-- ===========================================================================
-- Nothing is stored: each chat has a private Realtime broadcast channel,
-- `typing:<conversation_id>`, that only the chat's members may join.

create or replace function public.is_typing_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  id text := substring(p_topic from '^typing:(.*)$');
begin
  if id is null
    or id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_conversation_member(id::uuid);
end;
$$;

revoke execute on function public.is_typing_topic_member(text) from public, anon;
grant execute on function public.is_typing_topic_member(text) to authenticated;

do $$
begin
  drop policy if exists "Members receive typing in their chats" on realtime.messages;
  create policy "Members receive typing in their chats"
    on realtime.messages for select to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and public.is_typing_topic_member((select realtime.topic()))
    );

  drop policy if exists "Members send typing in their chats" on realtime.messages;
  create policy "Members send typing in their chats"
    on realtime.messages for insert to authenticated
    with check (
      realtime.messages.extension = 'broadcast'
      and public.is_typing_topic_member((select realtime.topic()))
    );
exception when undefined_table or invalid_schema_name or undefined_function then
  raise notice 'Realtime Authorization unavailable (%): typing indicators are disabled.', sqlerrm;
end;
$$;

commit;

-- Hardening from a security review of the earlier migrations.
--
-- 1. New messages: the server sets the columns only it should control.
--    Before, a sender could insert with read_at/delivered_at already set
--    (fake blue ticks), a far-future created_at or read_at (a burn timer that
--    never runs out, an edit window that never closes, a chat pinned to the top
--    of the list), viewed_at set on a view-once photo (never burned), or
--    deleted_at set alongside a plaintext body (plaintext past the encryption
--    check). Photos must also live in their own chat's folder.
-- 2. start_conversation: the wrong-code limit could be overrun by sending
--    guesses in parallel, and two people adding each other at the same moment
--    could end up with two separate chats.
-- 3. New sign-ups: if the code space ever filled up, choosing a code looped
--    forever; it now gives up after a number of tries.
-- 4. Photos of messages burned by the background sweep were left in Storage
--    (nothing kept their paths). The sweep now queues them, and the app deletes
--    them the next time either person opens the chat.
-- 5. message_burns_at depends on the current time's interval arithmetic, so
--    it's STABLE, not IMMUTABLE.
--
-- Safe to run more than once, and safe to paste into the SQL Editor as is.

-- ---------------------------------------------------------------------------
-- 1. Server-controlled columns on new messages
-- ---------------------------------------------------------------------------

-- Normally added by the message-edits migration; here too so this file works
-- on its own (the trigger below sets it).
alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.sanitize_new_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.delivered_at := null;
  new.read_at := null;
  new.viewed_at := null;
  new.deleted_at := null;
  new.edited_at := null;

  if new.body is not null then
    raise exception 'Messages must be encrypted';
  end if;

  if new.kind = 'image' then
    if new.attachment_path is null
      or lower(split_part(new.attachment_path, '/', 1)) <> new.conversation_id::text then
      raise exception 'A photo must be stored in its own chat''s folder';
    end if;
  elsif new.attachment_path is not null or new.view_once then
    raise exception 'Only photos have attachments or can be view once';
  end if;

  return new;
end;
$$;

drop trigger if exists ghost_sanitize_new_message on public.messages;
create trigger ghost_sanitize_new_message
  before insert on public.messages
  for each row execute function public.sanitize_new_message();

revoke execute on function public.sanitize_new_message() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. start_conversation: serialised wrong-code count, one chat per pair
-- ---------------------------------------------------------------------------

create or replace function public.start_conversation(friend_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  friend uuid;
  convo uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  -- One lookup per user at a time, so parallel guesses can't all pass the
  -- count before any of them records a failure.
  perform pg_advisory_xact_lock(hashtext('ghost-code-lookup:' || me::text));

  delete from public.code_lookup_failures
  where user_id = me and failed_at < now() - interval '1 hour';

  if (select count(*) from public.code_lookup_failures where user_id = me) >= 20 then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;

  select p.id into friend
  from public.profiles p
  where lower(p.ghost_code) = lower(trim(friend_code));

  -- Null (not an error) so the recorded failure isn't rolled back.
  if friend is null then
    insert into public.code_lookup_failures (user_id) values (me);
    return null;
  end if;
  if friend = me then
    raise exception 'That is your own code';
  end if;

  -- One chat per pair, even when both add each other at the same moment.
  perform pg_advisory_xact_lock(
    hashtext('ghost-pair:' || least(me, friend)::text || ':' || greatest(me, friend)::text)
  );

  -- If an earlier race left two chats, always pick the same (oldest) one.
  select a.conversation_id into convo
  from public.conversation_members a
  join public.conversation_members b on b.conversation_id = a.conversation_id
  join public.conversations c on c.id = a.conversation_id
  where a.user_id = me and b.user_id = friend
  order by c.created_at, c.id
  limit 1;

  if convo is null then
    insert into public.conversations default values returning id into convo;
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, me), (convo, friend);
  end if;

  return convo;
end;
$$;

revoke execute on function public.start_conversation(text) from public, anon;
grant execute on function public.start_conversation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. New sign-ups: give up instead of looping forever
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt integer := 0;
begin
  loop
    attempt := attempt + 1;
    begin
      insert into public.profiles (id, ghost_code)
      values (new.id, public.generate_ghost_code())
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      -- Ghost code collision: try another, but not forever.
      if attempt >= 200 then
        raise exception 'Could not find a free Ghost code';
      end if;
    end;
  end loop;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Photos of messages burned by the background sweep
-- ---------------------------------------------------------------------------

-- Encrypted files whose messages are gone, waiting for an app to delete them
-- through the Storage API (deleting storage.objects rows in SQL would leave
-- the files themselves behind).
create table if not exists public.attachment_cleanup (
  path text primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  queued_at timestamptz not null default now()
);

alter table public.attachment_cleanup enable row level security;
revoke all on public.attachment_cleanup from anon, authenticated;

-- What the background job runs: delete expired messages, queue their photos.
create or replace function public.sweep_expired_messages()
returns void
language sql
security definer
set search_path = ''
as $$
  with burned as (
    delete from public.messages m
    where m.burn_seconds is not null
      and public.message_burns_at(m) <= now()
    returning m.attachment_path, m.conversation_id
  )
  insert into public.attachment_cleanup (path, conversation_id)
  select attachment_path, conversation_id from burned
  where attachment_path is not null
  on conflict (path) do nothing;
$$;

revoke execute on function public.sweep_expired_messages() from public, anon, authenticated;

-- Hands a chat member the queued files of that chat to delete, and forgets them.
create or replace function public.claim_attachment_cleanup(p_conversation_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a member of this conversation';
  end if;
  return query
    delete from public.attachment_cleanup a
    where a.conversation_id = p_conversation_id
    returning a.path;
end;
$$;

revoke execute on function public.claim_attachment_cleanup(uuid) from public, anon;
grant execute on function public.claim_attachment_cleanup(uuid) to authenticated;

-- Point the background job at the new sweep. Skipped, with a notice, without pg_cron.
do $$
begin
  begin
    perform cron.unschedule('ghost-burn-expired-messages');
  exception when others then
    null; -- not scheduled yet
  end;
  perform cron.schedule(
    'ghost-burn-expired-messages',
    '* * * * *',
    'select public.sweep_expired_messages()'
  );
exception when others then
  raise notice 'pg_cron unavailable (%): expired messages will be burned by the apps only.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Correct volatility
-- ---------------------------------------------------------------------------

alter function public.message_burns_at(public.messages) stable;

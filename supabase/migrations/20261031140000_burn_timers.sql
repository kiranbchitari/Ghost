-- Disappearing messages and erase-for-everyone.
--
-- Each conversation has a burn timer (off, or N seconds) that starts either
-- when a message is read or when it's sent. Every new message copies the
-- conversation's setting, so changing the timer only affects later messages.
-- Expired messages are deleted outright, by whichever member's app notices
-- first, or by a pg_cron job when nobody has the chat open.

alter table public.conversations
  add column burn_seconds integer check (burn_seconds is null or burn_seconds between 1 and 604800),
  add column burn_mode text not null default 'read' check (burn_mode in ('read', 'sent')),
  -- Set when someone erases the chat; tells the other phone to clear its view.
  add column cleared_at timestamptz;

alter table public.messages
  add column burn_seconds integer,
  add column burn_mode text check (burn_mode in ('read', 'sent'));

-- Copy the conversation's timer onto each new message, so a client can't send
-- a message that skips it.
create function public.apply_burn_timer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.burn_seconds, case when c.burn_seconds is null then null else c.burn_mode end
  into new.burn_seconds, new.burn_mode
  from public.conversations c
  where c.id = new.conversation_id;
  return new;
end;
$$;

create trigger ghost_apply_burn_timer
  before insert on public.messages
  for each row execute function public.apply_burn_timer();

-- When a message burns: read mode counts from read_at (unread messages wait),
-- sent mode from created_at.
create function public.message_burns_at(m public.messages)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when m.burn_seconds is null then null
    when m.burn_mode = 'sent' then m.created_at + make_interval(secs => m.burn_seconds)
    when m.read_at is not null then m.read_at + make_interval(secs => m.burn_seconds)
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Either member can change the timer (null turns it off).
create function public.set_burn_timer(p_conversation_id uuid, p_seconds integer, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a member of this conversation';
  end if;
  update public.conversations
  set burn_seconds = p_seconds, burn_mode = coalesce(p_mode, burn_mode)
  where id = p_conversation_id;
end;
$$;

-- Deletes this conversation's expired messages and returns their attachment
-- paths so the caller can remove the encrypted files from Storage.
create function public.burn_expired_messages(p_conversation_id uuid)
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
    delete from public.messages m
    where m.conversation_id = p_conversation_id
      and public.message_burns_at(m) <= now()
    returning m.attachment_path;
end;
$$;

-- Erase the whole history for both members. Returns attachment paths to
-- remove from Storage.
create function public.erase_conversation(p_conversation_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Not a member of this conversation';
  end if;
  update public.conversations set cleared_at = now() where id = p_conversation_id;
  return query
    delete from public.messages m
    where m.conversation_id = p_conversation_id
    returning m.attachment_path;
end;
$$;

revoke execute on function public.apply_burn_timer() from public, anon, authenticated;
revoke execute on function public.set_burn_timer(uuid, integer, text) from public, anon;
revoke execute on function public.burn_expired_messages(uuid) from public, anon;
revoke execute on function public.erase_conversation(uuid) from public, anon;
grant execute on function public.set_burn_timer(uuid, integer, text) to authenticated;
grant execute on function public.burn_expired_messages(uuid) to authenticated;
grant execute on function public.erase_conversation(uuid) to authenticated;

-- Timer changes and erasures reach the other phone live.
alter publication supabase_realtime add table public.conversations;

-- ---------------------------------------------------------------------------
-- Background sweep: burn expired messages even when nobody has the chat open.
-- Needs pg_cron (Database -> Extensions in the Supabase dashboard). Skipped,
-- with a notice, if it isn't available.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'ghost-burn-expired-messages',
    '* * * * *',
    $job$
      delete from public.messages m
      where m.burn_seconds is not null
        and public.message_burns_at(m) <= now()
    $job$
  );
exception when others then
  raise notice 'pg_cron unavailable (%): expired messages will be burned by the apps only.', sqlerrm;
end;
$$;

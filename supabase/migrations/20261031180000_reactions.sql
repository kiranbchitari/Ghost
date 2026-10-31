-- Message reactions, like WhatsApp: each member can put one emoji on any
-- message in their chat. The emoji is encrypted on the device with the chat's
-- shared key, so the server only ever sees ciphertext.
--
-- Removing a reaction clears its ciphertext rather than deleting the row: an
-- UPDATE reaches the other phone through Realtime with the row's
-- conversation_id, which DELETE events (primary key only) can't be filtered on.

create table public.message_reactions (
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

create index message_reactions_conversation_id_idx on public.message_reactions (conversation_id);

alter table public.message_reactions enable row level security;

-- Reading only: reactions are written through set_reaction(), which checks
-- the message belongs to one of the caller's chats.
create policy "Members read reactions"
  on public.message_reactions for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Sets (or, with nulls, removes) the caller's reaction to a message.
create function public.set_reaction(p_message_id uuid, p_ciphertext text, p_nonce text)
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
    and m.deleted_at is null;

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
create function public.drop_reactions_of_deleted_message()
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

create trigger messages_drop_reactions_when_deleted
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.drop_reactions_of_deleted_message();

revoke execute on function public.set_reaction(uuid, text, text) from public, anon;
revoke execute on function public.drop_reactions_of_deleted_message() from public, anon, authenticated;
grant execute on function public.set_reaction(uuid, text, text) to authenticated;

-- Reactions reach the other phone live (filtered by the select policy above).
alter publication supabase_realtime add table public.message_reactions;

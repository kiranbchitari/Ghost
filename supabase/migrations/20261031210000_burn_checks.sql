-- Burned means gone: a message whose burn timer has run out can no longer be
-- edited or reacted to, even in the moments before the sweep deletes it.
--
-- Safe to run more than once, and safe to paste into the SQL Editor as is.

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

-- create or replace keeps existing grants; restated so this file also works alone.
revoke execute on function public.set_reaction(uuid, text, text) from public, anon;
revoke execute on function public.edit_message(uuid, text, text) from public, anon;
grant execute on function public.set_reaction(uuid, text, text) to authenticated;
grant execute on function public.edit_message(uuid, text, text) to authenticated;

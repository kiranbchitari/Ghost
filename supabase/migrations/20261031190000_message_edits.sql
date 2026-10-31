-- Editing a sent message, for 5 minutes after sending (like WhatsApp's 15).
-- The new text is encrypted on the device; the server swaps the ciphertext and
-- stamps edited_at so both phones can show "Edited".

alter table public.messages
  add column edited_at timestamptz;

-- Only the sender, only text messages that are still there, and only within
-- the window. The window has 30 seconds of grace so an edit started just
-- before the 5 minutes were up isn't refused for network lag.
create function public.edit_message(p_message_id uuid, p_ciphertext text, p_nonce text)
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
  returning m.edited_at into stamp;

  if stamp is null then
    raise exception 'This message can no longer be edited';
  end if;
  return stamp;
end;
$$;

revoke execute on function public.edit_message(uuid, text, text) from public, anon;
grant execute on function public.edit_message(uuid, text, text) to authenticated;

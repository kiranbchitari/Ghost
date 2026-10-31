-- Swipe to reply: a message can quote an earlier message in the same chat.
-- Only the id is stored; each phone shows the quote from its own decrypted
-- copy, so the server never sees what was quoted.

alter table public.messages
  add column reply_to uuid references public.messages (id) on delete set null;

-- Keeps "on delete set null" fast when burned messages are swept.
create index messages_reply_to_idx on public.messages (reply_to);

create function public.check_reply_in_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to and m.conversation_id = new.conversation_id
  ) then
    raise exception 'A reply must quote a message in the same chat';
  end if;
  return new;
end;
$$;

-- Clients can't update messages directly (only through RPCs), so checking on
-- insert is enough.
create trigger messages_reply_in_conversation
  before insert on public.messages
  for each row execute function public.check_reply_in_conversation();

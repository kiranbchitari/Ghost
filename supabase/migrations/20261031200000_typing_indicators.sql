-- Live typing indicators. Nothing is stored: each chat has a private Realtime
-- broadcast channel, `typing:<conversation_id>`, and only that chat's members
-- may join it (Realtime Authorization checks these policies on join).

-- True when the topic is 'typing:<uuid>' and the caller belongs to that chat.
-- Never errors on other topics.
create function public.is_typing_topic_member(p_topic text)
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

-- Skipped, with a notice, on a stack whose Realtime predates Authorization;
-- the app then simply shows no typing indicator.
do $$
begin
  create policy "Members receive typing in their chats"
    on realtime.messages for select to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and public.is_typing_topic_member((select realtime.topic()))
    );

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

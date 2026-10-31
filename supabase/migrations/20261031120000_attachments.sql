-- Encrypted photo messages, view-once photos and delete-for-everyone.
-- Photos are encrypted on the device; Storage only ever holds ciphertext.

alter table public.messages
  add column kind text not null default 'text' check (kind in ('text', 'image')),
  -- '<conversation_id>/<random id>' in the attachments bucket.
  add column attachment_path text,
  add column view_once boolean not null default false,
  add column viewed_at timestamptz,
  add column deleted_at timestamptz;

-- A deleted message keeps no content, so relax the encryption check for it.
-- Still NOT VALID: plaintext rows from before end-to-end encryption remain.
alter table public.messages drop constraint messages_must_be_encrypted;
alter table public.messages
  add constraint messages_must_be_encrypted
  check (deleted_at is not null or (body is null and ciphertext is not null and nonce is not null))
  not valid;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, folders named after the conversation id
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 15728640)
on conflict (id) do nothing;

-- True when the caller belongs to the conversation in the object's first
-- path segment. Never errors on names that aren't '<uuid>/...'.
create function public.is_attachment_member(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_conversation_member(folder::uuid);
end;
$$;

create policy "Members upload attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_attachment_member(name));

create policy "Members read attachments"
  on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_attachment_member(name));

-- Either member may delete: the sender when deleting for everyone, the
-- recipient after opening a view-once photo.
create policy "Members delete attachments"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.is_attachment_member(name));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Delete for everyone: only the sender, and the content is wiped, not hidden.
create function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages
  set deleted_at = now(),
      body = null,
      ciphertext = null,
      nonce = null,
      attachment_path = null
  where id = p_message_id
    and sender_id = (select auth.uid())
    and deleted_at is null;

  if not found then
    raise exception 'Message not found, already deleted, or not yours';
  end if;
end;
$$;

-- The recipient opened a view-once photo: record it and drop the pointer to
-- the file (the app deletes the file itself through the Storage API).
create function public.mark_message_viewed(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages m
  set viewed_at = now(),
      attachment_path = null,
      read_at = coalesce(m.read_at, now()),
      delivered_at = coalesce(m.delivered_at, now())
  where m.id = p_message_id
    and m.view_once
    and m.viewed_at is null
    and m.deleted_at is null
    and m.sender_id <> (select auth.uid())
    and public.is_conversation_member(m.conversation_id);
$$;

-- Adds the last message's kind and deletion so the list can show
-- "Photo" or "Message deleted" without decrypting anything.
drop function public.list_conversations();

create function public.list_conversations()
returns table (
  conversation_id uuid,
  friend_code text,
  friend_public_key text,
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
  order by 9 desc;
$$;

revoke execute on function public.is_attachment_member(text) from public, anon;
revoke execute on function public.delete_message(uuid) from public, anon;
revoke execute on function public.mark_message_viewed(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.is_attachment_member(text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.mark_message_viewed(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;

-- One-to-one messaging between anonymous users.
-- Every user gets a short Ghost code; sharing it is how two people connect.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  ghost_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_members_user_id_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Ghost codes: 8 characters, no look-alikes (0/O, 1/I/L)
-- ---------------------------------------------------------------------------

create function public.generate_ghost_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  loop
    begin
      insert into public.profiles (id, ghost_code)
      values (new.id, public.generate_ghost_code())
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      -- Ghost code collision: try another.
    end;
  end loop;
  return new;
end;
$$;

create trigger ghost_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users created before this migration.
insert into public.profiles (id, ghost_code)
select id, public.generate_ghost_code() from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Security definer so policies on conversation_members can use it without
-- recursing into their own policy.
create function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = (select auth.uid())
  );
$$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Codes are only resolvable through start_conversation(), never listable.
create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Members read their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

create policy "Members read conversation membership"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Members read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Members send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- RPCs (conversations are only created here)
-- ---------------------------------------------------------------------------

-- Opens (or reuses) the one-to-one conversation with the owner of a code.
create function public.start_conversation(friend_code text)
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

  select p.id into friend
  from public.profiles p
  where p.ghost_code = upper(trim(friend_code));

  if friend is null then
    raise exception 'No Ghost found with that code';
  end if;
  if friend = me then
    raise exception 'That is your own code';
  end if;

  select a.conversation_id into convo
  from public.conversation_members a
  join public.conversation_members b on b.conversation_id = a.conversation_id
  where a.user_id = me and b.user_id = friend
  limit 1;

  if convo is null then
    insert into public.conversations default values returning id into convo;
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, me), (convo, friend);
  end if;

  return convo;
end;
$$;

-- The signed-in user's conversations, newest activity first.
create function public.list_conversations()
returns table (
  conversation_id uuid,
  friend_code text,
  last_message text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, p.ghost_code, lm.body, coalesce(lm.created_at, c.created_at)
  from public.conversation_members mine
  join public.conversations c on c.id = mine.conversation_id
  join public.conversation_members other
    on other.conversation_id = c.id and other.user_id <> mine.user_id
  join public.profiles p on p.id = other.user_id
  left join lateral (
    select m.body, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where mine.user_id = (select auth.uid())
  order by 4 desc;
$$;

revoke execute on function public.generate_ghost_code() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_conversation_member(uuid) from public, anon;
revoke execute on function public.start_conversation(text) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.start_conversation(text) to authenticated;
grant execute on function public.list_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: deliver new messages live (filtered by the select policy above)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;

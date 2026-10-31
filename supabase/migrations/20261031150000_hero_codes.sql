-- Ghost codes become a hero name plus four digits (Thor4821): easy to say and
-- share. Codes are matched case-insensitively.
--
-- The names must match HEROES in src/features/profile/heroes.ts (name without
-- spaces, punctuation or a leading "The"), so the app can show the matching badge.

create or replace function public.generate_ghost_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select (array[
    'SpiderMan', 'IronMan', 'CaptainAmerica', 'Thor', 'Hulk', 'BlackPanther',
    'BlackWidow', 'DoctorStrange', 'CaptainMarvel', 'ScarletWitch', 'Hawkeye',
    'Groot', 'Wolverine', 'Deadpool', 'Batman', 'Superman', 'WonderWoman',
    'Flash', 'Aquaman', 'GreenLantern', 'Cyborg', 'Shazam', 'MartianManhunter',
    'Nightwing'
  ])[1 + floor(random() * 24)::int]
  || lpad(floor(random() * 10000)::int::text, 4, '0');
$$;

-- Give everyone a hero code. Row by row, so a collision only retries that row.
do $$
declare
  profile_id uuid;
begin
  for profile_id in select id from public.profiles loop
    loop
      begin
        update public.profiles set ghost_code = public.generate_ghost_code() where id = profile_id;
        exit;
      exception when unique_violation then
        -- Code taken: try another.
      end;
    end loop;
  end loop;
end;
$$;

-- Lookups compare lowercased codes; this also stops Thor4821 and THOR4821
-- from ever belonging to two people.
create unique index profiles_ghost_code_lower_idx on public.profiles (lower(ghost_code));

-- ---------------------------------------------------------------------------
-- Wrong-code throttle: with ~240,000 possible codes, someone could otherwise
-- find people by trying codes in a loop.
-- ---------------------------------------------------------------------------

create table public.code_lookup_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);

create index code_lookup_failures_user_id_failed_at_idx
  on public.code_lookup_failures (user_id, failed_at);

-- Only start_conversation (security definer) touches it.
alter table public.code_lookup_failures enable row level security;
revoke all on public.code_lookup_failures from anon, authenticated;

-- Returns null, rather than raising, for an unknown code: raising would roll
-- back the recorded failure.
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

  delete from public.code_lookup_failures
  where user_id = me and failed_at < now() - interval '1 hour';

  if (select count(*) from public.code_lookup_failures where user_id = me) >= 20 then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;

  select p.id into friend
  from public.profiles p
  where lower(p.ghost_code) = lower(trim(friend_code));

  if friend is null then
    insert into public.code_lookup_failures (user_id) values (me);
    return null;
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

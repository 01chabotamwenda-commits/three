-- Career Campus: per-user cloud data store
-- All app data (profile, applications, contacts, etc.) is kept in a single
-- JSONB document per user so the mobile app can sync across devices.

create table if not exists public.cc_user_data (
  user_id            uuid        not null references auth.users(id) on delete cascade,
  profile            jsonb,
  applications       jsonb       not null default '[]'::jsonb,
  contacts           jsonb       not null default '[]'::jsonb,
  saved_events       jsonb       not null default '[]'::jsonb,
  documents          jsonb       not null default '[]'::jsonb,
  letters            jsonb       not null default '[]'::jsonb,
  interview_sessions jsonb       not null default '[]'::jsonb,
  updated_at         timestamptz not null default now(),
  constraint cc_user_data_pkey primary key (user_id)
);

alter table public.cc_user_data enable row level security;

-- Users can only read/write their own row
create policy "Users own their data"
  on public.cc_user_data
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

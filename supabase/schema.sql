-- Dooby Cloud schema. Run once in Supabase → SQL Editor.
--
-- One row per signed-in user holding the whole spaces/collections document
-- as JSON. Row Level Security makes each user able to see and change only
-- their own row; the anon key shipped in the extension cannot read anything
-- without a valid user session.

create table if not exists public.dooby_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb        not null default '{}'::jsonb,
  updated_at timestamptz  not null default now()
);

alter table public.dooby_data enable row level security;

drop policy if exists "dooby_data: owner can read"   on public.dooby_data;
drop policy if exists "dooby_data: owner can insert" on public.dooby_data;
drop policy if exists "dooby_data: owner can update" on public.dooby_data;
drop policy if exists "dooby_data: owner can delete" on public.dooby_data;

create policy "dooby_data: owner can read"
  on public.dooby_data for select
  using (auth.uid() = user_id);

create policy "dooby_data: owner can insert"
  on public.dooby_data for insert
  with check (auth.uid() = user_id);

create policy "dooby_data: owner can update"
  on public.dooby_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "dooby_data: owner can delete"
  on public.dooby_data for delete
  using (auth.uid() = user_id);

-- Keep documents small enough to stay fast (1 MB is ~10x Chrome's sync quota).
alter table public.dooby_data
  drop constraint if exists dooby_data_size_check;
alter table public.dooby_data
  add constraint dooby_data_size_check check (pg_column_size(data) < 1048576);

grant select, insert, update, delete on public.dooby_data to authenticated;

create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  room_id text not null unique,
  mentor_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references auth.users(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'ended', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 180),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists sessions_mentor_id_idx on public.sessions (mentor_id);
create index if not exists sessions_student_id_idx on public.sessions (student_id);
create index if not exists sessions_status_idx on public.sessions (status);

create or replace function public.set_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
before update on public.sessions
for each row
execute function public.set_sessions_updated_at();

alter table public.sessions enable row level security;

drop policy if exists "participants can read sessions" on public.sessions;
drop policy if exists "students can read joinable sessions" on public.sessions;
drop policy if exists "mentors can create sessions" on public.sessions;
drop policy if exists "students can join open sessions" on public.sessions;
drop policy if exists "participants can end sessions" on public.sessions;

create policy "participants can read sessions"
on public.sessions
for select
using (auth.uid() = mentor_id or auth.uid() = student_id);

create policy "students can read joinable sessions"
on public.sessions
for select
using (
  auth.jwt() -> 'user_metadata' ->> 'role' = 'student'
  and student_id is null
  and status in ('scheduled', 'active')
);

create policy "mentors can create sessions"
on public.sessions
for insert
with check (
  auth.uid() = mentor_id
  and auth.jwt() -> 'user_metadata' ->> 'role' = 'mentor'
  and student_id is null
);

create policy "students can join open sessions"
on public.sessions
for update
using (
  auth.jwt() -> 'user_metadata' ->> 'role' = 'student'
  and student_id is null
  and status in ('scheduled', 'active')
)
with check (
  auth.uid() = student_id
  and mentor_id <> auth.uid()
  and status in ('scheduled', 'active', 'ended')
);

create policy "participants can end sessions"
on public.sessions
for update
using (auth.uid() = mentor_id or auth.uid() = student_id)
with check (auth.uid() = mentor_id or auth.uid() = student_id);

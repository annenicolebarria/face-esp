alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

create or replace function public.lookup_login_email(login_identity text)
returns text
language sql
security definer
set search_path = public
as $$
  select u.email
  from public.users u
  where lower(u.username) = lower(login_identity)
     or lower(u.email) = lower(login_identity)
  limit 1;
$$;

grant execute on function public.lookup_login_email(text) to anon, authenticated;

grant select, update on table public.users to authenticated;
grant select on table public.attendance_logs to authenticated;
grant select on table public.cameras to authenticated;
grant select, insert, update on table public.fan_state to authenticated;
grant select, insert on table public.fan_events to authenticated;

alter table public.users enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.cameras enable row level security;
alter table public.fan_state enable row level security;
alter table public.fan_events enable row level security;

drop policy if exists users_select_self on public.users;
create policy users_select_self
on public.users
for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists users_update_self on public.users;
create policy users_update_self
on public.users
for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists attendance_logs_authenticated_select on public.attendance_logs;
create policy attendance_logs_authenticated_select
on public.attendance_logs
for select
to authenticated
using (true);

drop policy if exists cameras_authenticated_select on public.cameras;
create policy cameras_authenticated_select
on public.cameras
for select
to authenticated
using (true);

drop policy if exists fan_state_authenticated_select on public.fan_state;
create policy fan_state_authenticated_select
on public.fan_state
for select
to authenticated
using (true);

drop policy if exists fan_state_authenticated_insert on public.fan_state;
create policy fan_state_authenticated_insert
on public.fan_state
for insert
to authenticated
with check (true);

drop policy if exists fan_state_authenticated_update on public.fan_state;
create policy fan_state_authenticated_update
on public.fan_state
for update
to authenticated
using (true)
with check (true);

drop policy if exists fan_events_authenticated_select on public.fan_events;
create policy fan_events_authenticated_select
on public.fan_events
for select
to authenticated
using (true);

drop policy if exists fan_events_authenticated_insert on public.fan_events;
create policy fan_events_authenticated_insert
on public.fan_events
for insert
to authenticated
with check (true);

with inserted as (
  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  )
  select
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    u.email,
    u.password_hash,
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('username', u.username, 'role', u.role),
    now(),
    now(),
    false,
    false
  from public.users u
  where u.password_hash is not null
    and u.auth_user_id is null
    and not exists (
      select 1
      from auth.users au
      where lower(au.email) = lower(u.email)
    )
  returning id, email
),
identities as (
  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  select
    inserted.email,
    inserted.id,
    jsonb_build_object(
      'sub', inserted.id::text,
      'email', inserted.email,
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  from inserted
  returning user_id
)
update public.users u
set auth_user_id = au.id
from auth.users au
where lower(au.email) = lower(u.email)
  and (u.auth_user_id is null or u.auth_user_id <> au.id);

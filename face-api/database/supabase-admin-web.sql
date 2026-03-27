create table if not exists public.admin_sessions (
  token text primary key,
  admin_id bigint not null references public.admins(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_admin_sessions_admin_id on public.admin_sessions(admin_id);
create index if not exists idx_admin_sessions_expires_at on public.admin_sessions(expires_at);

update public.admins
set password_hash = extensions.crypt('admin', extensions.gen_salt('bf')),
    updated_at = now()
where username = 'admin'
  and extensions.crypt('admin', password_hash) <> password_hash;

create or replace function public.admin_assert_session(session_token text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_admin_id bigint;
begin
  delete from public.admin_sessions
  where expires_at <= now();

  select s.admin_id
  into resolved_admin_id
  from public.admin_sessions s
  join public.admins a on a.id = s.admin_id
  where s.token = session_token
    and s.expires_at > now()
    and a.is_active = true
  limit 1;

  if resolved_admin_id is null then
    raise exception 'Admin session expired. Please log in again.';
  end if;

  update public.admin_sessions
  set last_seen_at = now()
  where token = session_token;

  return resolved_admin_id;
end;
$$;

create or replace function public.admin_login(login_username text, login_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row public.admins%rowtype;
  session_token text;
begin
  if coalesce(trim(login_username), '') = '' or coalesce(login_password, '') = '' then
    raise exception 'Username and password are required.';
  end if;

  select *
  into admin_row
  from public.admins
  where username = trim(login_username)
    and is_active = true
  limit 1;

  if admin_row.id is null or extensions.crypt(login_password, admin_row.password_hash) <> admin_row.password_hash then
    raise exception 'Invalid username or password.';
  end if;

  session_token := extensions.gen_random_uuid()::text;

  insert into public.admin_sessions (token, admin_id, expires_at)
  values (session_token, admin_row.id, now() + interval '8 hours');

  update public.admins
  set last_login_at = now()
  where id = admin_row.id;

  return jsonb_build_object(
    'token', session_token,
    'admin', jsonb_build_object(
      'id', admin_row.id,
      'username', admin_row.username
    )
  );
end;
$$;

create or replace function public.admin_logout(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.admin_sessions
  where token = session_token;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_validate_session(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id bigint;
  admin_row public.admins%rowtype;
begin
  admin_id := public.admin_assert_session(session_token);

  select *
  into admin_row
  from public.admins
  where id = admin_id
  limit 1;

  return jsonb_build_object(
    'admin', jsonb_build_object(
      'id', admin_row.id,
      'username', admin_row.username
    )
  );
end;
$$;

create or replace function public.admin_get_users(session_token text)
returns table (
  id bigint,
  first_name text,
  last_name text,
  username text,
  email text,
  role text,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_session(session_token);

  return query
  select
    u.id,
    u.first_name,
    u.last_name,
    u.username,
    u.email,
    u.role,
    u.status,
    u.updated_at
  from public.users u
  order by u.id desc;
end;
$$;

create or replace function public.admin_get_logs(session_token text, logs_limit integer default 100)
returns table (
  id bigint,
  user_name_snapshot text,
  camera_id text,
  event text,
  confidence numeric,
  detected_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_session(session_token);

  return query
  select
    l.id,
    l.user_name_snapshot,
    l.camera_id,
    l.event,
    l.confidence,
    l.detected_at
  from public.attendance_logs l
  order by l.detected_at desc
  limit greatest(coalesce(logs_limit, 100), 1);
end;
$$;

create or replace function public.admin_get_attendance_logs(session_token text, logs_limit integer default 100)
returns table (
  id bigint,
  user_name_snapshot text,
  camera_id text,
  event text,
  confidence numeric,
  detected_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_session(session_token);

  return query
  select
    l.id,
    l.user_name_snapshot,
    l.camera_id,
    l.event,
    l.confidence,
    l.detected_at
  from public.attendance_logs l
  where l.event in ('entry', 'exit')
  order by l.detected_at desc
  limit greatest(coalesce(logs_limit, 100), 1);
end;
$$;

create or replace function public.admin_get_cameras_summary(session_token text)
returns table (
  camera_id text,
  area text,
  status text,
  last_detected_at timestamptz,
  recognized_today integer,
  unrecognized_today integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_session(session_token);

  return query
  select
    c.camera_id,
    c.area,
    case
      when coalesce(logs.last_detected_at, c.last_seen_at) >= now() - interval '30 seconds'
        then 'online'
      else 'offline'
    end as status,
    coalesce(logs.last_detected_at, c.last_seen_at) as last_detected_at,
    coalesce(logs.recognized_today, 0)::int as recognized_today,
    coalesce(logs.unrecognized_today, 0)::int as unrecognized_today
  from public.cameras c
  left join (
    select
      l.camera_id,
      max(l.detected_at) as last_detected_at,
      count(*) filter (
        where l.detected_at::date = current_date and l.event in ('entry', 'exit')
      ) as recognized_today,
      count(*) filter (
        where l.detected_at::date = current_date and l.event = 'unrecognized'
      ) as unrecognized_today
    from public.attendance_logs l
    group by l.camera_id
  ) logs on logs.camera_id = c.camera_id
  order by c.camera_id asc;
end;
$$;

create or replace function public.admin_get_sensor_snapshot(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sensor_row public.sensor_logs%rowtype;
  fan_row public.fan_state%rowtype;
begin
  perform public.admin_assert_session(session_token);

  select *
  into sensor_row
  from public.sensor_logs
  order by created_at desc
  limit 1;

  select *
  into fan_row
  from public.fan_state
  where device_key = 'main_fan'
  limit 1;

  return jsonb_build_object(
    'deviceKey', coalesce(sensor_row.device_key, 'acebott-main-01'),
    'pirState', coalesce(sensor_row.pir_state, false),
    'fanIsOn', coalesce(sensor_row.fan_is_on, fan_row.is_on, false),
    'temperatureC', sensor_row.temperature_c,
    'humidity', sensor_row.humidity,
    'createdAt', sensor_row.created_at,
    'fanUpdatedAt', fan_row.updated_at,
    'fanUpdatedBy', coalesce(fan_row.updated_by_label, 'system')
  );
end;
$$;

create or replace function public.admin_update_user(
  session_token text,
  target_user_id bigint,
  next_role text default null,
  next_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.users%rowtype;
begin
  perform public.admin_assert_session(session_token);

  if next_role is not null and next_role not in ('admin', 'user') then
    raise exception 'Invalid role.';
  end if;

  if next_status is not null and next_status not in ('active', 'inactive', 'pending') then
    raise exception 'Invalid status.';
  end if;

  update public.users
  set
    role = coalesce(next_role, role),
    status = coalesce(next_status, status),
    updated_at = now()
  where id = target_user_id
  returning *
  into updated_row;

  if updated_row.id is null then
    raise exception 'User not found.';
  end if;

  return jsonb_build_object(
    'id', updated_row.id,
    'firstName', updated_row.first_name,
    'lastName', updated_row.last_name,
    'username', updated_row.username,
    'email', updated_row.email,
    'role', updated_row.role,
    'status', updated_row.status,
    'updatedAt', updated_row.updated_at
  );
end;
$$;

create or replace function public.admin_delete_user(session_token text, target_user_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_id bigint;
begin
  perform public.admin_assert_session(session_token);

  delete from public.users
  where id = target_user_id
  returning id into deleted_id;

  if deleted_id is null then
    raise exception 'User not found.';
  end if;

  return jsonb_build_object('id', deleted_id);
end;
$$;

create or replace function public.admin_create_user(
  session_token text,
  input_first_name text,
  input_last_name text,
  input_username text,
  input_email text,
  input_role text default 'user',
  input_status text default 'active',
  input_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_row public.users%rowtype;
  normalized_email text;
begin
  perform public.admin_assert_session(session_token);

  normalized_email := lower(trim(coalesce(input_email, '')));

  if trim(coalesce(input_first_name, '')) = ''
    or trim(coalesce(input_last_name, '')) = ''
    or trim(coalesce(input_username, '')) = ''
    or normalized_email = ''
    or trim(coalesce(input_password, '')) = '' then
    raise exception 'Please complete all fields.';
  end if;

  if input_role not in ('admin', 'user') then
    raise exception 'Invalid role.';
  end if;

  if input_status not in ('active', 'inactive', 'pending') then
    raise exception 'Invalid status.';
  end if;

  if length(input_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  insert into public.users (
    first_name,
    last_name,
    username,
    email,
    role,
    status,
    password_hash
  )
  values (
    trim(input_first_name),
    trim(input_last_name),
    trim(input_username),
    normalized_email,
    input_role,
    input_status,
    extensions.crypt(input_password, extensions.gen_salt('bf'))
  )
  returning *
  into created_row;

  return jsonb_build_object(
    'id', created_row.id,
    'firstName', created_row.first_name,
    'lastName', created_row.last_name,
    'username', created_row.username,
    'email', created_row.email,
    'role', created_row.role,
    'status', created_row.status,
    'updatedAt', created_row.updated_at
  );
exception
  when unique_violation then
    raise exception 'Username or email already exists.';
end;
$$;

create or replace function public.admin_update_credentials(
  session_token text,
  current_password text,
  new_username text default null,
  new_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id bigint;
  admin_row public.admins%rowtype;
begin
  admin_id := public.admin_assert_session(session_token);

  select *
  into admin_row
  from public.admins
  where id = admin_id
  limit 1;

  if trim(coalesce(current_password, '')) = '' then
    raise exception 'Enter current password to save changes.';
  end if;

  if extensions.crypt(current_password, admin_row.password_hash) <> admin_row.password_hash then
    raise exception 'Current password is incorrect.';
  end if;

  if trim(coalesce(new_username, '')) = '' and trim(coalesce(new_password, '')) = '' then
    raise exception 'Enter a new username or password to update.';
  end if;

  if trim(coalesce(new_password, '')) <> '' and length(new_password) < 6 then
    raise exception 'New password must be at least 6 characters.';
  end if;

  update public.admins
  set
    username = coalesce(nullif(trim(new_username), ''), username),
    password_hash = case
      when trim(coalesce(new_password, '')) <> '' then extensions.crypt(new_password, extensions.gen_salt('bf'))
      else password_hash
    end,
    updated_at = now()
  where id = admin_id
  returning *
  into admin_row;

  return jsonb_build_object(
    'admin', jsonb_build_object(
      'id', admin_row.id,
      'username', admin_row.username
    )
  );
exception
  when unique_violation then
    raise exception 'Username already exists.';
end;
$$;

grant execute on function public.admin_login(text, text) to anon, authenticated;
grant execute on function public.admin_logout(text) to anon, authenticated;
grant execute on function public.admin_validate_session(text) to anon, authenticated;
grant execute on function public.admin_get_users(text) to anon, authenticated;
grant execute on function public.admin_get_logs(text, integer) to anon, authenticated;
grant execute on function public.admin_get_attendance_logs(text, integer) to anon, authenticated;
grant execute on function public.admin_get_cameras_summary(text) to anon, authenticated;
grant execute on function public.admin_get_sensor_snapshot(text) to anon, authenticated;
grant execute on function public.admin_update_user(text, bigint, text, text) to anon, authenticated;
grant execute on function public.admin_delete_user(text, bigint) to anon, authenticated;
grant execute on function public.admin_create_user(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_update_credentials(text, text, text, text) to anon, authenticated;

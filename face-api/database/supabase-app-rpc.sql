create table if not exists public.app_sessions (
  token text primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_app_sessions_user_id on public.app_sessions(user_id);
create index if not exists idx_app_sessions_expires_at on public.app_sessions(expires_at);

update public.users
set password_hash = extensions.crypt('user123', extensions.gen_salt('bf')),
    updated_at = now()
where email in (
    'maria.santos@ptc.edu.ph',
    'juan.delacruz@ptc.edu.ph',
    'liza.ramos@ptc.edu.ph',
    'richelda.salva@ptc.edu.ph',
    'chrisjade.arendon@ptc.edu.ph',
    'anne.nicole@ptc.edu.ph',
    'canicolebarria@gmail.com',
    'testaccount@gmail.com'
  )
  and (password_hash is null or extensions.crypt('user123', password_hash) <> password_hash);

create or replace function public.app_assert_session(session_token text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id bigint;
begin
  delete from public.app_sessions
  where expires_at <= now();

  select s.user_id
  into resolved_user_id
  from public.app_sessions s
  join public.users u on u.id = s.user_id
  where s.token = session_token
    and s.expires_at > now()
    and u.status = 'active'
  limit 1;

  if resolved_user_id is null then
    raise exception 'Session expired. Please log in again.';
  end if;

  update public.app_sessions
  set last_seen_at = now()
  where token = session_token;

  return resolved_user_id;
end;
$$;

create or replace function public.app_login(login_identity text, login_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row public.users%rowtype;
  session_token text;
  normalized_identity text;
begin
  normalized_identity := lower(trim(coalesce(login_identity, '')));

  if normalized_identity = '' or coalesce(login_password, '') = '' then
    raise exception 'Username/email and password are required.';
  end if;

  select *
  into user_row
  from public.users
  where lower(username) = normalized_identity
     or lower(email) = normalized_identity
  limit 1;

  if user_row.id is null
    or user_row.role <> 'user'
    or user_row.password_hash is null
    or extensions.crypt(login_password, user_row.password_hash) <> user_row.password_hash then
    raise exception 'Invalid credentials.';
  end if;

  if user_row.status = 'pending' then
    raise exception 'Your registration is pending admin approval.';
  end if;

  if user_row.status <> 'active' then
    raise exception 'Your account is inactive. Please contact the admin.';
  end if;

  session_token := extensions.gen_random_uuid()::text;

  insert into public.app_sessions (token, user_id, expires_at)
  values (session_token, user_row.id, now() + interval '30 days');

  return jsonb_build_object(
    'token', session_token,
    'user', jsonb_build_object(
      'id', user_row.id,
      'firstName', user_row.first_name,
      'lastName', user_row.last_name,
      'username', user_row.username,
      'email', user_row.email,
      'profileImageUrl', user_row.profile_image_url,
      'role', user_row.role,
      'status', user_row.status,
      'createdAt', user_row.created_at,
      'updatedAt', user_row.updated_at
    )
  );
end;
$$;

create or replace function public.app_register(
  input_first_name text,
  input_last_name text,
  input_username text,
  input_email text,
  input_password text
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
  normalized_email := lower(trim(coalesce(input_email, '')));

  if trim(coalesce(input_first_name, '')) = ''
    or trim(coalesce(input_last_name, '')) = ''
    or trim(coalesce(input_username, '')) = ''
    or normalized_email = ''
    or trim(coalesce(input_password, '')) = '' then
    raise exception 'Please complete all registration fields.';
  end if;

  if length(trim(input_password)) < 6 then
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
    'user',
    'pending',
    extensions.crypt(input_password, extensions.gen_salt('bf'))
  )
  returning *
  into created_row;

  return jsonb_build_object(
    'message', 'Registration submitted. Wait for admin approval before logging in.',
    'user', jsonb_build_object(
      'id', created_row.id,
      'firstName', created_row.first_name,
      'lastName', created_row.last_name,
      'username', created_row.username,
      'email', created_row.email,
      'profileImageUrl', created_row.profile_image_url,
      'role', created_row.role,
      'status', created_row.status,
      'createdAt', created_row.created_at,
      'updatedAt', created_row.updated_at
    )
  );
exception
  when unique_violation then
    raise exception 'Username or email already exists.';
end;
$$;

create or replace function public.app_logout(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.app_sessions
  where token = session_token;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.app_validate_session(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_id bigint;
  user_row public.users%rowtype;
begin
  user_id := public.app_assert_session(session_token);

  select *
  into user_row
  from public.users u
  where u.id = user_id
  limit 1;

  return jsonb_build_object(
    'id', user_row.id,
    'firstName', user_row.first_name,
    'lastName', user_row.last_name,
    'username', user_row.username,
    'email', user_row.email,
    'profileImageUrl', user_row.profile_image_url,
    'role', user_row.role,
    'status', user_row.status,
    'createdAt', user_row.created_at,
    'updatedAt', user_row.updated_at
  );
end;
$$;

create or replace function public.app_get_my_logs(session_token text, logs_limit integer default 60)
returns table (
  id bigint,
  user_id bigint,
  user_name_snapshot text,
  camera_id text,
  event text,
  confidence numeric,
  detected_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id bigint;
begin
  resolved_user_id := public.app_assert_session(session_token);

  return query
  select
    l.id,
    l.user_id,
    l.user_name_snapshot,
    l.camera_id,
    l.event,
    l.confidence,
    l.detected_at,
    l.created_at
  from public.attendance_logs l
  where l.user_id = resolved_user_id
  order by l.detected_at desc
  limit greatest(coalesce(logs_limit, 60), 1);
end;
$$;

create or replace function public.app_get_global_logs(session_token text, logs_limit integer default 120)
returns table (
  id bigint,
  user_id bigint,
  user_name_snapshot text,
  camera_id text,
  event text,
  confidence numeric,
  detected_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_assert_session(session_token);

  return query
  select
    l.id,
    l.user_id,
    l.user_name_snapshot,
    l.camera_id,
    l.event,
    l.confidence,
    l.detected_at,
    l.created_at
  from public.attendance_logs l
  order by l.detected_at desc
  limit greatest(coalesce(logs_limit, 120), 1);
end;
$$;

create or replace function public.app_get_cameras_summary(session_token text)
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
  perform public.app_assert_session(session_token);

  return query
  select
    c.camera_id,
    c.area,
    case
      when coalesce(logs.last_detected_at, c.last_seen_at) >= now() - interval '10 minutes'
        then 'online'
      else 'offline'
    end as status,
    coalesce(logs.last_detected_at, c.last_seen_at) as last_detected_at,
    coalesce(logs.recognized_today, 0)::int as recognized_today,
    coalesce(logs.unrecognized_today, 0)::int as unrecognized_today
  from public.cameras c
  left join (
    select
      l.camera_id as log_camera_id,
      max(l.detected_at) as last_detected_at,
      count(*) filter (
        where l.detected_at::date = current_date and l.event in ('entry', 'exit')
      ) as recognized_today,
      count(*) filter (
        where l.detected_at::date = current_date and l.event = 'unrecognized'
      ) as unrecognized_today
    from public.attendance_logs l
    group by l.camera_id
  ) logs on logs.log_camera_id = c.camera_id
  order by c.camera_id asc;
end;
$$;

create or replace function public.app_get_sensor_snapshot(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sensor_row public.sensor_logs%rowtype;
  fan_row public.fan_state%rowtype;
begin
  perform public.app_assert_session(session_token);

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

create or replace function public.app_get_fan_state(session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fan_row public.fan_state%rowtype;
begin
  perform public.app_assert_session(session_token);

  select *
  into fan_row
  from public.fan_state
  where device_key = 'main_fan'
  limit 1;

  return jsonb_build_object(
    'isOn', coalesce(fan_row.is_on, false),
    'updatedAt', fan_row.updated_at,
    'updatedBy', coalesce(fan_row.updated_by_label, 'system')
  );
end;
$$;

create or replace function public.app_set_fan_state(session_token text, next_is_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id bigint;
  user_row public.users%rowtype;
  fan_row public.fan_state%rowtype;
begin
  resolved_user_id := public.app_assert_session(session_token);

  select *
  into user_row
  from public.users u
  where u.id = resolved_user_id
  limit 1;

  insert into public.fan_state (
    device_key,
    is_on,
    updated_at,
    updated_by_user_id,
    updated_by_label
  )
  values (
    'main_fan',
    coalesce(next_is_on, false),
    now(),
    user_row.id,
    coalesce(user_row.username, user_row.email, 'system')
  )
  on conflict (device_key)
  do update set
    is_on = excluded.is_on,
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_by_label = excluded.updated_by_label
  returning *
  into fan_row;

  insert into public.fan_events (
    device_key,
    is_on,
    updated_by_user_id,
    updated_by_label,
    created_at
  )
  values (
    'main_fan',
    coalesce(next_is_on, false),
    user_row.id,
    coalesce(user_row.username, user_row.email, 'system'),
    now()
  );

  return jsonb_build_object(
    'isOn', coalesce(fan_row.is_on, false),
    'updatedAt', fan_row.updated_at,
    'updatedBy', coalesce(fan_row.updated_by_label, 'system')
  );
end;
$$;

create or replace function public.app_get_notifications(session_token text, item_limit integer default 80)
returns table (
  id text,
  type text,
  title text,
  message text,
  at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id bigint;
  user_row public.users%rowtype;
begin
  resolved_user_id := public.app_assert_session(session_token);

  select *
  into user_row
  from public.users u
  where u.id = resolved_user_id
  limit 1;

  return query
  with detection_notifications as (
    select
      'log-' || l.id::text as id,
      'detection'::text as type,
      case
        when l.event = 'entry' then 'Face detected'
        else 'Exit logged'
      end as title,
      coalesce(l.camera_id, 'ESP32-CAM-01') || ' recognized you with '
        || round(coalesce(l.confidence, 0))::text || '% confidence.' as message,
      l.detected_at as at
    from public.attendance_logs l
    where l.event in ('entry', 'exit')
      and (
        l.user_id = resolved_user_id
        or (
          l.user_id is null
          and lower(trim(coalesce(l.user_name_snapshot, ''))) = lower(trim(concat_ws(' ', user_row.first_name, user_row.last_name)))
        )
      )
    order by l.detected_at desc
    limit greatest(coalesce(item_limit, 80), 1)
  ),
  incident_notifications as (
    select
      'incident-' || l.id::text as id,
      'incident'::text as type,
      'Unknown face detected'::text as title,
      coalesce(l.camera_id, 'ESP32-CAM-01') || ' captured an unrecognized face with '
        || round(coalesce(l.confidence, 0))::text || '% confidence.' as message,
      l.detected_at as at
    from public.attendance_logs l
    where l.event = 'unrecognized'
    order by l.detected_at desc
    limit greatest(coalesce(item_limit, 80), 1)
  ),
  recent_sensor_logs as (
    select
      logs.*
    from public.sensor_logs logs
    order by logs.created_at desc
    limit 200
  ),
  motion_notifications as (
    select
      'motion-' || s.id::text as id,
      'motion'::text as type,
      case
        when s.pir_state then 'PIR motion detected'
        else 'PIR motion cleared'
      end as title,
      s.device_key || ' reported '
        || case
          when s.pir_state then 'active motion'
          else 'no motion'
        end
        || '.' as message,
      s.created_at as at
    from (
      select
        logs.*,
        lag(logs.pir_state) over (partition by logs.device_key order by logs.created_at) as previous_pir_state
      from recent_sensor_logs logs
    ) s
    where s.previous_pir_state is distinct from s.pir_state
    order by s.created_at desc
    limit greatest(coalesce(item_limit, 80), 1)
  ),
  fan_notifications as (
    select
      'fan-' || f.id::text as id,
      'fan'::text as type,
      case when f.is_on then 'Fan turned on' else 'Fan turned off' end as title,
      'Updated by ' || coalesce(f.updated_by_label, 'system') || '.' as message,
      f.created_at as at
    from public.fan_events f
    order by f.created_at desc
    limit greatest(coalesce(item_limit, 80), 1)
  )
  select *
  from (
    select * from detection_notifications
    union all
    select * from incident_notifications
    union all
    select * from motion_notifications
    union all
    select * from fan_notifications
  ) notifications
  order by at desc
  limit greatest(coalesce(item_limit, 80), 1);
end;
$$;

create or replace function public.app_update_profile(
  session_token text,
  input_first_name text,
  input_last_name text,
  input_username text,
  input_email text,
  input_profile_image_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id bigint;
  updated_row public.users%rowtype;
begin
  resolved_user_id := public.app_assert_session(session_token);

  if trim(coalesce(input_first_name, '')) = ''
    or trim(coalesce(input_last_name, '')) = ''
    or trim(coalesce(input_username, '')) = ''
    or trim(coalesce(input_email, '')) = '' then
    raise exception 'Please complete all profile fields.';
  end if;

  update public.users
  set
    first_name = trim(input_first_name),
    last_name = trim(input_last_name),
    username = trim(input_username),
    email = lower(trim(input_email)),
    profile_image_url = nullif(trim(coalesce(input_profile_image_url, '')), ''),
    updated_at = now()
  where public.users.id = resolved_user_id
  returning *
  into updated_row;

  return jsonb_build_object(
    'message', 'Profile updated.',
    'user', jsonb_build_object(
      'id', updated_row.id,
      'firstName', updated_row.first_name,
      'lastName', updated_row.last_name,
      'username', updated_row.username,
      'email', updated_row.email,
      'profileImageUrl', updated_row.profile_image_url,
      'role', updated_row.role,
      'status', updated_row.status,
      'createdAt', updated_row.created_at,
      'updatedAt', updated_row.updated_at
    )
  );
exception
  when unique_violation then
    raise exception 'Username or email already exists.';
end;
$$;

create or replace function public.app_change_password(
  session_token text,
  current_password text,
  new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_user_id bigint;
  user_row public.users%rowtype;
begin
  resolved_user_id := public.app_assert_session(session_token);

  select *
  into user_row
  from public.users u
  where u.id = resolved_user_id
  limit 1;

  if trim(coalesce(current_password, '')) = '' then
    raise exception 'Current password is required.';
  end if;

  if trim(coalesce(new_password, '')) = '' then
    raise exception 'New password is required.';
  end if;

  if length(new_password) < 6 then
    raise exception 'New password must be at least 6 characters.';
  end if;

  if user_row.password_hash is null
    or extensions.crypt(current_password, user_row.password_hash) <> user_row.password_hash then
    raise exception 'Current password is incorrect.';
  end if;

  update public.users
  set
    password_hash = extensions.crypt(new_password, extensions.gen_salt('bf')),
    updated_at = now()
  where public.users.id = resolved_user_id;

  return jsonb_build_object('message', 'Password updated successfully.');
end;
$$;

grant execute on function public.app_login(text, text) to anon, authenticated;
grant execute on function public.app_register(text, text, text, text, text) to anon, authenticated;
grant execute on function public.app_logout(text) to anon, authenticated;
grant execute on function public.app_validate_session(text) to anon, authenticated;
grant execute on function public.app_get_my_logs(text, integer) to anon, authenticated;
grant execute on function public.app_get_global_logs(text, integer) to anon, authenticated;
grant execute on function public.app_get_cameras_summary(text) to anon, authenticated;
grant execute on function public.app_get_sensor_snapshot(text) to anon, authenticated;
grant execute on function public.app_get_fan_state(text) to anon, authenticated;
grant execute on function public.app_set_fan_state(text, boolean) to anon, authenticated;
grant execute on function public.app_get_notifications(text, integer) to anon, authenticated;
grant execute on function public.app_update_profile(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.app_change_password(text, text, text) to anon, authenticated;

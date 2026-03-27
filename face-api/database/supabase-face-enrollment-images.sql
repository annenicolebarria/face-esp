insert into storage.buckets (id, name, public)
values ('face-enrollment', 'face-enrollment', true)
on conflict (id) do update
set public = excluded.public;

create table if not exists public.face_enrollment_images (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  pose_key text not null,
  pose_label text not null,
  capture_order integer not null,
  storage_path text not null,
  public_url text,
  content_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pose_key)
);

create index if not exists idx_face_enrollment_images_user_id
  on public.face_enrollment_images(user_id);

grant select, insert, update on public.face_enrollment_images to anon, authenticated;

alter table public.face_enrollment_images enable row level security;

drop policy if exists face_enrollment_images_insert_open on public.face_enrollment_images;
create policy face_enrollment_images_insert_open
on public.face_enrollment_images
for insert
to anon, authenticated
with check (true);

drop policy if exists face_enrollment_images_update_open on public.face_enrollment_images;
create policy face_enrollment_images_update_open
on public.face_enrollment_images
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists face_enrollment_images_select_open on public.face_enrollment_images;
create policy face_enrollment_images_select_open
on public.face_enrollment_images
for select
to anon, authenticated
using (true);

drop policy if exists storage_face_enrollment_insert on storage.objects;
create policy storage_face_enrollment_insert
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'face-enrollment');

drop policy if exists storage_face_enrollment_update on storage.objects;
create policy storage_face_enrollment_update
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'face-enrollment')
with check (bucket_id = 'face-enrollment');

drop policy if exists storage_face_enrollment_select on storage.objects;
create policy storage_face_enrollment_select
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'face-enrollment');

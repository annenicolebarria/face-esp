insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists storage_profile_pictures_insert on storage.objects;
create policy storage_profile_pictures_insert
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'profile-pictures');

drop policy if exists storage_profile_pictures_update on storage.objects;
create policy storage_profile_pictures_update
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'profile-pictures')
with check (bucket_id = 'profile-pictures');

drop policy if exists storage_profile_pictures_select on storage.objects;
create policy storage_profile_pictures_select
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'profile-pictures');

drop policy if exists storage_profile_pictures_delete on storage.objects;
create policy storage_profile_pictures_delete
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'profile-pictures');

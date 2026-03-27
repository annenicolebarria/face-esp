grant insert on table public.contact_messages to anon, authenticated;
grant select, update on table public.contact_messages to authenticated;

alter table public.contact_messages enable row level security;

drop policy if exists contact_messages_anon_insert on public.contact_messages;
create policy contact_messages_anon_insert
on public.contact_messages
for insert
to anon, authenticated
with check (
  length(trim(name)) >= 2
  and position('@' in email) > 1
  and length(trim(message)) >= 10
  and source = 'website'
);

drop policy if exists contact_messages_authenticated_select on public.contact_messages;
create policy contact_messages_authenticated_select
on public.contact_messages
for select
to authenticated
using (true);

drop policy if exists contact_messages_authenticated_update on public.contact_messages;
create policy contact_messages_authenticated_update
on public.contact_messages
for update
to authenticated
using (true)
with check (true);

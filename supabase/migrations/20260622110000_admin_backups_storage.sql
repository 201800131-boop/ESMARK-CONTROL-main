-- Respaldos administrativos completos guardados en Supabase Storage local.
-- El bucket es privado y solo los usuarios administradores pueden usarlo.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'admin-backups',
  'admin-backups',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin_backups_select" on storage.objects;
create policy "admin_backups_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'admin-backups'
  and public.is_current_user_admin()
);

drop policy if exists "admin_backups_insert" on storage.objects;
create policy "admin_backups_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'admin-backups'
  and public.is_current_user_admin()
);

drop policy if exists "admin_backups_update" on storage.objects;
create policy "admin_backups_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'admin-backups'
  and public.is_current_user_admin()
)
with check (
  bucket_id = 'admin-backups'
  and public.is_current_user_admin()
);

drop policy if exists "admin_backups_delete" on storage.objects;
create policy "admin_backups_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'admin-backups'
  and public.is_current_user_admin()
);

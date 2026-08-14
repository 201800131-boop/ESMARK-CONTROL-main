-- Reemplaza politicas antiguas que usaban auth.user_metadata.
-- user_metadata es editable por el usuario; los permisos usan app_metadata.

alter table public.reportes_generados enable row level security;

drop policy if exists "Admin can delete all reports" on public.reportes_generados;
drop policy if exists "Admin can insert reports" on public.reportes_generados;
drop policy if exists "Admin can update all reports" on public.reportes_generados;
drop policy if exists "Admin can view all reports" on public.reportes_generados;
drop policy if exists "Area users can insert reports of their area" on public.reportes_generados;
drop policy if exists "Area users can view their area reports" on public.reportes_generados;
drop policy if exists "Service role has full access" on public.reportes_generados;
drop policy if exists "Users can create their own reports" on public.reportes_generados;
drop policy if exists "Users can view their own reports" on public.reportes_generados;
drop policy if exists "admin_absolute_reportes_generados" on public.reportes_generados;
drop policy if exists "reportes_generados_delete_admin" on public.reportes_generados;

create policy "admin_absolute_reportes_generados"
on public.reportes_generados
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

create policy "reportes_generados_select_own"
on public.reportes_generados
for select
to authenticated
using ((select auth.uid()) = generado_por);

create policy "reportes_generados_insert_own"
on public.reportes_generados
for insert
to authenticated
with check ((select auth.uid()) = generado_por);

create policy "reportes_generados_select_area"
on public.reportes_generados
for select
to authenticated
using (
  (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'area'
  and area = ((select auth.jwt()) -> 'app_metadata' ->> 'area')
);

create policy "reportes_generados_insert_area"
on public.reportes_generados
for insert
to authenticated
with check (
  (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'area'
  and area = ((select auth.jwt()) -> 'app_metadata' ->> 'area')
);

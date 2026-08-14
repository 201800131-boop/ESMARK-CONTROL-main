-- Las decisiones de autorizacion deben usar app_metadata, que solo puede
-- modificar el servidor con service_role. raw_user_meta_data es editable por
-- el usuario y no es una fuente segura para conceder permisos administrativos.

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
  'role', coalesce(raw_app_meta_data ->> 'role', raw_user_meta_data ->> 'role', 'area'),
  'area', coalesce(raw_app_meta_data ->> 'area', raw_user_meta_data ->> 'area'),
  'activo', coalesce((raw_app_meta_data ->> 'activo')::boolean, (raw_user_meta_data ->> 'activo')::boolean, true)
)
where raw_user_meta_data ? 'role';

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.raw_app_meta_data ->> 'role' = 'admin'
      and coalesce((u.raw_app_meta_data ->> 'activo')::boolean, true)
  );
$$;

revoke all on function public.is_current_user_admin() from public;
revoke all on function public.is_current_user_admin() from anon;
grant execute on function public.is_current_user_admin() to authenticated;

-- Corrige recursion infinita en RLS de public.profiles.
-- La funcion de admin no debe consultar public.profiles cuando se usa en
-- politicas de public.profiles, porque eso dispara una evaluacion recursiva.

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and (
      (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or exists (
        select 1
        from auth.users u
        where u.id = auth.uid()
          and (
            u.raw_user_meta_data ->> 'role' = 'admin'
            or u.raw_app_meta_data ->> 'role' = 'admin'
          )
          and coalesce(u.raw_user_meta_data ->> 'activo', 'true') <> 'false'
      )
    );
$$;

drop policy if exists "Admin lee todos los perfiles" on public.profiles;
drop policy if exists "Admin inserta perfiles" on public.profiles;
drop policy if exists "Admin actualiza perfiles" on public.profiles;
drop policy if exists "admin_absolute_profiles" on public.profiles;

create policy "admin_absolute_profiles"
on public.profiles
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

grant execute on function public.is_current_user_admin() to authenticated;

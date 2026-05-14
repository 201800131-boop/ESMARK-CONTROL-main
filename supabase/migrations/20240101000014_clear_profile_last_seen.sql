-- Migration: clear_profile_last_seen
-- Limpia la presencia del usuario actual al cerrar sesion.

create or replace function public.clear_profile_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set last_seen = null
  where id = auth.uid();
end;
$$;

revoke all on function public.clear_profile_last_seen() from public;
grant execute on function public.clear_profile_last_seen() to authenticated;

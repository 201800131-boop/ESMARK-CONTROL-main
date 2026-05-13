-- Migration: touch_profile_last_seen
-- Permite que cada usuario actualice solo su propio last_seen sin abrir permisos de update completos.

create or replace function public.touch_profile_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set last_seen = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.touch_profile_last_seen() from public;
grant execute on function public.touch_profile_last_seen() to authenticated;

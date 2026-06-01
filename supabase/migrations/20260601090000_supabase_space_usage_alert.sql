-- Alerta de uso de espacio de Supabase para ESMARK Control.
-- Mide el tamano de la base de datos y lo compara contra un limite configurable
-- guardado en public.system_settings. Ajusta supabase_space_limit_mb al limite
-- real de tu proyecto si cambia el plan de Supabase.

create table if not exists public.system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.system_settings (key, value)
values ('supabase_space_limit_mb', '500')
on conflict (key) do nothing;

alter table public.system_settings enable row level security;

drop policy if exists "system_settings_admin_all" on public.system_settings;
create policy "system_settings_admin_all"
on public.system_settings
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

create or replace function public.obtener_uso_espacio_supabase()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_db_bytes bigint;
  v_limit_mb numeric;
  v_limit_bytes numeric;
  v_percent numeric;
begin
  if not public.is_current_user_admin() then
    return jsonb_build_object(
      'success', false,
      'error', 'Solo administracion puede consultar uso de espacio'
    );
  end if;

  select pg_database_size(current_database()) into v_db_bytes;

  select nullif(value, '')::numeric
  into v_limit_mb
  from public.system_settings
  where key = 'supabase_space_limit_mb';

  v_limit_mb := coalesce(v_limit_mb, 500);
  v_limit_bytes := v_limit_mb * 1024 * 1024;
  v_percent := case
    when v_limit_bytes > 0 then round(((v_db_bytes::numeric / v_limit_bytes) * 100), 2)
    else 0
  end;

  return jsonb_build_object(
    'success', true,
    'database_bytes', v_db_bytes,
    'database_mb', round(v_db_bytes::numeric / 1024 / 1024, 2),
    'limit_mb', v_limit_mb,
    'percent_used', v_percent,
    'warning', v_percent >= 90,
    'checked_at', now()
  );
end;
$$;

grant execute on function public.obtener_uso_espacio_supabase() to authenticated;

-- Agrega el nombre del usuario que genera el cierre para mostrarlo en UI.
alter table if exists public.reportes_generados
  add column if not exists generado_por_nombre text;

-- Backfill para registros existentes.
update public.reportes_generados rg
set generado_por_nombre = coalesce(
  nullif(trim(coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'username',
    p.nombre,
    p.email
  )), ''),
  rg.generado_por::text
)
from auth.users u
left join public.profiles p on p.id = u.id
where rg.generado_por = u.id
  and (rg.generado_por_nombre is null or btrim(rg.generado_por_nombre) = '');

update public.reportes_generados
set generado_por_nombre = coalesce(generado_por_nombre, generado_por::text)
where generado_por is not null
  and (generado_por_nombre is null or btrim(generado_por_nombre) = '');

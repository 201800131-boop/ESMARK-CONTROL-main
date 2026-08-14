-- Define limites temporales explicitos por cierre y usa el instante real de ejecucion.
-- Un pedido ingresado despues del cierre queda en el siguiente corte, aunque
-- conserve una fecha operativa del periodo anterior.

alter table public.ultimo_cierre_quincenal
  add column if not exists corte_inicio timestamptz,
  add column if not exists corte_fin timestamptz;

alter table public.reportes_generados
  add column if not exists corte_inicio timestamptz,
  add column if not exists corte_fin timestamptz;

with ordered_closures as (
  select
    id,
    created_at,
    lag(created_at) over (order by created_at) as previous_created_at
  from public.ultimo_cierre_quincenal
)
update public.ultimo_cierre_quincenal target
set corte_fin = coalesce(target.corte_fin, ordered.created_at),
    corte_inicio = coalesce(target.corte_inicio, ordered.previous_created_at)
from ordered_closures ordered
where target.id = ordered.id
  and (target.corte_fin is null or target.corte_inicio is null);

update public.reportes_generados
set corte_fin = coalesce(corte_fin, created_at),
    corte_inicio = coalesce(corte_inicio, created_at);

create or replace function public.ejecutar_cierre_quincenal_manual(
  p_realizado_por uuid,
  p_realizado_por_nombre text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  f_ini date;
  f_fin date;
  area_rec record;
  t_reg int;
  t_uni int;
  t_act int;
  ultimo_cierre record;
  v_anio int;
  v_mes int;
  v_quincena int;
  v_generado_por_nombre text;
  v_corte_inicio timestamptz;
  v_corte_fin timestamptz;
begin
  if auth.uid() is null or auth.uid() <> p_realizado_por then
    return jsonb_build_object('success', false, 'error', 'Sesion no autorizada para ejecutar cierres');
  end if;

  if not (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.rol = 'administracion' or p.role = 'admin')
    )
    or exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.raw_user_meta_data ->> 'role' = 'admin'
        and coalesce(u.raw_user_meta_data ->> 'activo', 'true') <> 'false'
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'Solo administradores pueden ejecutar cierres');
  end if;

  v_generado_por_nombre := coalesce(nullif(btrim(p_realizado_por_nombre), ''), p_realizado_por::text);
  v_corte_fin := now();

  select corte_fin, fecha_fin
  into ultimo_cierre
  from public.ultimo_cierre_quincenal
  order by created_at desc
  limit 1;

  v_corte_inicio := coalesce(
    ultimo_cierre.corte_fin,
    (make_date(
      extract(year from timezone('America/Tegucigalpa', v_corte_fin))::int,
      extract(month from timezone('America/Tegucigalpa', v_corte_fin))::int,
      1
    )::timestamp at time zone 'America/Tegucigalpa')
  );

  f_ini := (timezone('America/Tegucigalpa', v_corte_inicio))::date;
  f_fin := (timezone('America/Tegucigalpa', v_corte_fin))::date;
  v_anio := extract(year from f_fin)::int;
  v_mes := extract(month from f_fin)::int;
  v_quincena := case when extract(day from f_fin) <= 15 then 1 else 2 end;

  for area_rec in select id, code from public.areas where code <> 'administracion' loop
    select count(*), coalesce(sum(cantidad_danada), 0)
    into t_reg, t_uni
    from public.pedidos_danados
    where fecha_registro > v_corte_inicio
      and fecha_registro <= v_corte_fin
      and area_id = area_rec.id;

    select count(*) into t_act
    from public.actividades
    where fecha_hora > v_corte_inicio
      and fecha_hora <= v_corte_fin
      and area_id = area_rec.id;

    insert into public.cierres_quincenales (
      anio, mes, quincena, fecha_inicio, fecha_fin, area_id,
      total_registros, total_unidades, total_actividades
    ) values (
      v_anio, v_mes, v_quincena, f_ini, f_fin, area_rec.id,
      t_reg, t_uni, t_act
    )
    on conflict (anio, mes, quincena, area_id)
    do update set
      total_registros = excluded.total_registros,
      total_unidades = excluded.total_unidades,
      total_actividades = excluded.total_actividades;

    insert into public.reportes_generados (
      area, generado_por, generado_por_nombre, fecha_inicio, fecha_fin,
      corte_inicio, corte_fin
    ) values (
      area_rec.code, p_realizado_por, v_generado_por_nombre, f_ini, f_fin,
      v_corte_inicio, v_corte_fin
    );
  end loop;

  insert into public.ultimo_cierre_quincenal (
    fecha_inicio, fecha_fin, realizado_por, realizado_por_nombre,
    corte_inicio, corte_fin
  ) values (
    f_ini, f_fin, p_realizado_por, v_generado_por_nombre,
    v_corte_inicio, v_corte_fin
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Cierre quincenal realizado exitosamente',
    'fecha_inicio', f_ini,
    'fecha_fin', f_fin,
    'corte_inicio', v_corte_inicio,
    'corte_fin', v_corte_fin,
    'quincena', v_quincena
  );
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

grant execute on function public.ejecutar_cierre_quincenal_manual(uuid, text) to authenticated;

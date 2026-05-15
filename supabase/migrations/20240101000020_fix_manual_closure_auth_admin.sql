-- Corrige la validacion de administrador del cierre manual.
-- Los usuarios de la app se administran en Supabase Auth user_metadata;
-- public.profiles puede estar vacia en instalaciones actuales.

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
begin
  if auth.uid() is null or auth.uid() <> p_realizado_por then
    return jsonb_build_object('success', false, 'error', 'Sesion no autorizada para ejecutar cierres');
  end if;

  if not (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (p.rol = 'administracion' or p.role = 'admin')
    )
    or exists (
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.raw_user_meta_data ->> 'role' = 'admin'
        and coalesce(u.raw_user_meta_data ->> 'activo', 'true') <> 'false'
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'Solo administradores pueden ejecutar cierres');
  end if;

  v_generado_por_nombre := coalesce(
    nullif(btrim(p_realizado_por_nombre), ''),
    p_realizado_por::text
  );

  select fecha_fin into ultimo_cierre
  from public.ultimo_cierre_quincenal
  order by created_at desc
  limit 1;

  if ultimo_cierre is null then
    f_ini := make_date(extract(year from now())::int, extract(month from now())::int, 1);
  else
    f_ini := (ultimo_cierre).fecha_fin + interval '1 day';
  end if;

  f_fin := (timezone('America/Tegucigalpa', now()))::date;

  v_anio := extract(year from f_fin)::int;
  v_mes := extract(month from f_fin)::int;
  if extract(day from f_fin) <= 15 then
    v_quincena := 1;
  else
    v_quincena := 2;
  end if;

  for area_rec in select id, code from public.areas where code <> 'administracion' loop
    select count(*), coalesce(sum(cantidad_danada), 0)
    into t_reg, t_uni
    from public.pedidos_danados
    where fecha between f_ini and f_fin
      and area_id = area_rec.id;

    select count(*)
    into t_act
    from public.actividades
    where (fecha_hora at time zone 'America/Tegucigalpa')::date between f_ini and f_fin
      and area_id = area_rec.id;

    insert into public.cierres_quincenales (
      anio,
      mes,
      quincena,
      fecha_inicio,
      fecha_fin,
      area_id,
      total_registros,
      total_unidades,
      total_actividades
    ) values (
      v_anio,
      v_mes,
      v_quincena,
      f_ini,
      f_fin,
      area_rec.id,
      t_reg,
      t_uni,
      t_act
    )
    on conflict (anio, mes, quincena, area_id)
    do update set
      total_registros = excluded.total_registros,
      total_unidades = excluded.total_unidades,
      total_actividades = excluded.total_actividades;

    insert into public.reportes_generados (
      area,
      generado_por,
      generado_por_nombre,
      fecha_inicio,
      fecha_fin
    )
    select
      area_rec.code,
      p_realizado_por,
      v_generado_por_nombre,
      f_ini,
      f_fin
    where not exists (
      select 1
      from public.reportes_generados rg
      where rg.area = area_rec.code
        and rg.fecha_inicio = f_ini
        and rg.fecha_fin = f_fin
        and rg.generado_por = p_realizado_por
    );
  end loop;

  insert into public.ultimo_cierre_quincenal (
    fecha_inicio,
    fecha_fin,
    realizado_por,
    realizado_por_nombre
  ) values (
    f_ini,
    f_fin,
    p_realizado_por,
    v_generado_por_nombre
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Cierre quincenal realizado exitosamente',
    'fecha_inicio', f_ini,
    'fecha_fin', f_fin,
    'quincena', v_quincena
  );
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

grant execute on function public.ejecutar_cierre_quincenal_manual(uuid, text) to authenticated;

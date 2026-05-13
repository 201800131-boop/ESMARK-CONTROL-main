-- Ajusta el cierre diario automático a las 4:25 PM (16:25) hora Tegucigalpa.
-- Incluye:
-- 1) validación de bloqueo de registros desde 16:25
-- 2) hora_cierre guardada como 16:25
-- 3) reprogramación del job pg_cron

-- 1) Trigger validation: bloquear registros desde 16:25
create or replace function public.validar_hora_registro()
returns trigger
language plpgsql
as $$
declare
  hora_local time;
  fecha_local date;
  cierre_existente int;
begin
  hora_local := (timezone('America/Tegucigalpa', now()))::time;
  fecha_local := (timezone('America/Tegucigalpa', now()))::date;

  if new.fecha <> fecha_local then
    raise exception 'La fecha es automática y no puede modificarse';
  end if;

  if hora_local >= time '16:25:00' then
    raise exception 'El día ya fue cerrado automáticamente a las 4:25 PM';
  end if;

  select count(*) into cierre_existente
  from public.cierres_diarios
  where fecha = fecha_local
    and area_id = new.area_id;

  if cierre_existente > 0 then
    raise exception 'Esta área ya fue cerrada para el día actual';
  end if;

  return new;
end;
$$;

-- 2) Cierre automático: guardar hora_cierre 16:25
create or replace function public.generar_cierre_diario_automatico()
returns void
language plpgsql
as $$
declare
  area_rec record;
  fecha_local date;
  total_registros int;
  total_unidades int;
  total_actividades int;
begin
  fecha_local := (timezone('America/Tegucigalpa', now()))::date;

  for area_rec in
    select id from public.areas where code <> 'administracion'
  loop
    if not exists (
      select 1 from public.cierres_diarios
      where fecha = fecha_local and area_id = area_rec.id
    ) then
      select count(*), coalesce(sum(cantidad_danada), 0)
      into total_registros, total_unidades
      from public.pedidos_danados
      where fecha = fecha_local and area_id = area_rec.id;

      select count(*)
      into total_actividades
      from public.actividades
      where (fecha_hora at time zone 'America/Tegucigalpa')::date = fecha_local
        and area_id = area_rec.id;

      insert into public.cierres_diarios (
        fecha, area_id, total_registros, total_unidades, total_actividades,
        hora_cierre, estado, generado_por, observacion
      ) values (
        fecha_local,
        area_rec.id,
        total_registros,
        total_unidades,
        total_actividades,
        time '16:25:00',
        'cerrado_automatico',
        'sistema',
        'Cierre automático diario ejecutado por sistema'
      )
      on conflict (fecha, area_id) do nothing;
    end if;
  end loop;
end;
$$;

-- 3) Reprogramar cron diario a 16:25
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cierre-diario-esmark') then
      perform cron.unschedule('cierre-diario-esmark');
    end if;

    perform cron.schedule(
      'cierre-diario-esmark',
      '25 16 * * *',
      $cron$select public.generar_cierre_diario_automatico();$cron$
    );
  end if;
exception
  when undefined_function then
    null;
end $$;

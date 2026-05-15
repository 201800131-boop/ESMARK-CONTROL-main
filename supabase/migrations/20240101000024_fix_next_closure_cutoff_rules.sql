-- Corrige el calculo del proximo cierre manual.
-- Regla: si el ultimo cierre termino el dia 15, el proximo rango va del 16 al fin de mes.
-- Si termino a fin de mes, el proximo rango va del 1 al 15 del mes siguiente.

create or replace function public.obtener_info_proximo_cierre()
returns jsonb
language plpgsql
stable
as $$
declare
  ultimo_cierre_rec record;
  tz_hoy date := (timezone('America/Tegucigalpa', now()))::date;
  f_ini date;
  f_fin date;
  dias_acumulados int;
  dias_restantes int;
begin
  select fecha_inicio, fecha_fin, created_at
  into ultimo_cierre_rec
  from public.ultimo_cierre_quincenal
  order by created_at desc
  limit 1;

  if ultimo_cierre_rec is null then
    -- Primer ciclo: del 1 al 15 del mes actual.
    f_ini := make_date(extract(year from tz_hoy)::int, extract(month from tz_hoy)::int, 1);
  else
    f_ini := ultimo_cierre_rec.fecha_fin + 1;
  end if;

  -- Fecha objetivo del cierre, respetando el corte quincenal.
  if extract(day from f_ini) <= 15 then
    f_fin := make_date(extract(year from f_ini)::int, extract(month from f_ini)::int, 15);
  else
    f_fin := (
      date_trunc('month', f_ini::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;
  end if;

  if tz_hoy < f_ini then
    dias_acumulados := 0;
  else
    dias_acumulados := greatest((least(tz_hoy, f_fin) - f_ini)::int + 1, 0);
  end if;

  dias_restantes := greatest((f_fin - tz_hoy)::int, 0);

  return jsonb_build_object(
    'fecha_inicio', f_ini,
    'fecha_fin', f_fin,
    'dias_acumulados', dias_acumulados,
    'dias_restantes', dias_restantes,
    'ultimo_cierre_realizado',
      case
        when ultimo_cierre_rec is null then null
        else jsonb_build_object(
          'fecha_inicio', ultimo_cierre_rec.fecha_inicio,
          'fecha_fin', ultimo_cierre_rec.fecha_fin,
          'created_at', ultimo_cierre_rec.created_at
        )
      end
  );
end;
$$;

grant execute on function public.obtener_info_proximo_cierre() to authenticated;

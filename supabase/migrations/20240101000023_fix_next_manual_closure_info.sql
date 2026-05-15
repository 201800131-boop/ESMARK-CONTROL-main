-- Actualiza la informacion del proximo cierre para el flujo manual.
-- Usa el ultimo cierre visible en reportes_generados, porque cada cierre manual
-- crea un registro por area y la UI ya depende de esa tabla para el historial.

create or replace function public.obtener_info_proximo_cierre()
returns jsonb
language plpgsql
stable
as $$
declare
  ultimo_cierre_rec record;
  v_now timestamptz := now();
  v_corte_inicio timestamptz;
  f_ini date;
  f_fin date;
  dias_acumulados int;
begin
  select fecha_inicio, fecha_fin, created_at
  into ultimo_cierre_rec
  from public.reportes_generados
  where coalesce(area, '') <> 'administracion'
  order by created_at desc
  limit 1;

  if ultimo_cierre_rec is null then
    f_ini := make_date(
      extract(year from timezone('America/Tegucigalpa', v_now))::int,
      extract(month from timezone('America/Tegucigalpa', v_now))::int,
      1
    );
    v_corte_inicio := f_ini::timestamp at time zone 'America/Tegucigalpa';
  else
    v_corte_inicio := ultimo_cierre_rec.created_at;
    f_ini := (timezone('America/Tegucigalpa', v_corte_inicio))::date;
  end if;

  f_fin := (timezone('America/Tegucigalpa', v_now))::date;
  dias_acumulados := greatest((f_fin - f_ini)::int + 1, 0);

  return jsonb_build_object(
    'fecha_inicio', f_ini,
    'fecha_fin', f_fin,
    'dias_acumulados', dias_acumulados,
    'corte_inicio', v_corte_inicio,
    'corte_fin', v_now,
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

-- Limpieza segura despues de un respaldo administrativo confirmado.
-- Mantiene configuracion, usuarios, areas y el ultimo cierre por area para no
-- romper el calculo del proximo cierre.

create or replace function public.limpiar_registros_respaldados(p_retention_days integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention_days integer := greatest(coalesce(p_retention_days, 15), 1);
  v_cutoff_date date := (timezone('America/Tegucigalpa', now())::date - v_retention_days);
  v_deleted_actividades integer := 0;
  v_deleted_auditoria integer := 0;
  v_deleted_cierres_diarios integer := 0;
  v_deleted_cierres_mensuales integer := 0;
  v_deleted_cierres_quincenales integer := 0;
  v_deleted_pedidos_danados integer := 0;
  v_deleted_reportes_generados integer := 0;
begin
  if not public.is_current_user_admin() then
    return jsonb_build_object(
      'success', false,
      'error', 'Solo administracion puede limpiar registros respaldados.'
    );
  end if;

  delete from public.actividades a
  where (a.fecha_hora at time zone 'America/Tegucigalpa')::date < v_cutoff_date;
  get diagnostics v_deleted_actividades = row_count;

  delete from public.auditoria a
  where (a.fecha_hora at time zone 'America/Tegucigalpa')::date < v_cutoff_date;
  get diagnostics v_deleted_auditoria = row_count;

  delete from public.cierres_diarios cd
  where cd.fecha < v_cutoff_date;
  get diagnostics v_deleted_cierres_diarios = row_count;

  delete from public.cierres_mensuales cm
  where (make_date(cm.anio, cm.mes, 1) + interval '1 month' - interval '1 day')::date < v_cutoff_date;
  get diagnostics v_deleted_cierres_mensuales = row_count;

  delete from public.cierres_quincenales cq
  where cq.fecha_fin < v_cutoff_date
    and cq.id not in (
      select latest.id
      from (
        select distinct on (cq_keep.area_id)
          cq_keep.id,
          cq_keep.area_id,
          cq_keep.fecha_fin,
          cq_keep.created_at
        from public.cierres_quincenales cq_keep
        order by
          cq_keep.area_id,
          cq_keep.fecha_fin desc,
          cq_keep.created_at desc
      ) latest
    );
  get diagnostics v_deleted_cierres_quincenales = row_count;

  delete from public.reportes_generados rg
  where rg.fecha_fin < v_cutoff_date
    and rg.id not in (
      select latest.id
      from (
        select distinct on (coalesce(rg_keep.area, ''))
          rg_keep.id,
          coalesce(rg_keep.area, '') as area_key,
          rg_keep.fecha_fin,
          rg_keep.created_at
        from public.reportes_generados rg_keep
        where rg_keep.fecha_fin is not null
        order by
          coalesce(rg_keep.area, ''),
          rg_keep.fecha_fin desc,
          rg_keep.created_at desc
      ) latest
    );
  get diagnostics v_deleted_reportes_generados = row_count;

  delete from public.pedidos_danados pd
  where pd.fecha < v_cutoff_date
    and not exists (
      select 1
      from public.actividades a
      where a.pedido_danado_id = pd.id
    );
  get diagnostics v_deleted_pedidos_danados = row_count;

  return jsonb_build_object(
    'success', true,
    'retention_days', v_retention_days,
    'cutoff_date', v_cutoff_date,
    'deleted', jsonb_build_object(
      'actividades', v_deleted_actividades,
      'auditoria', v_deleted_auditoria,
      'cierres_diarios', v_deleted_cierres_diarios,
      'cierres_mensuales', v_deleted_cierres_mensuales,
      'cierres_quincenales', v_deleted_cierres_quincenales,
      'pedidos_danados', v_deleted_pedidos_danados,
      'reportes_generados', v_deleted_reportes_generados
    ),
    'total_deleted',
      v_deleted_actividades +
      v_deleted_auditoria +
      v_deleted_cierres_diarios +
      v_deleted_cierres_mensuales +
      v_deleted_cierres_quincenales +
      v_deleted_pedidos_danados +
      v_deleted_reportes_generados
  );
end;
$$;

revoke all on function public.limpiar_registros_respaldados(integer) from public;
revoke all on function public.limpiar_registros_respaldados(integer) from anon;
grant execute on function public.limpiar_registros_respaldados(integer) to authenticated;

-- Borra cierres y reportes desde RPC para no depender de politicas RLS
-- inconsistentes entre profiles y user_metadata.

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and (
            p.rol = 'administracion'
            or p.role = 'admin'
          )
      )
      or exists (
        select 1
        from auth.users u
        where u.id = auth.uid()
          and (
            u.raw_user_meta_data ->> 'role' = 'admin'
            or u.raw_app_meta_data ->> 'role' = 'admin'
          )
          and coalesce(u.raw_user_meta_data ->> 'activo', 'true') <> 'false'
      )
    );
$$;

create or replace function public.eliminar_reporte_admin(p_reporte_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted int;
begin
  if not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Solo administradores pueden eliminar reportes');
  end if;

  delete from public.pedidos_danados
  where id = p_reporte_id;

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('success', false, 'error', 'No se encontro el reporte o ya fue eliminado');
  end if;

  return jsonb_build_object('success', true, 'deleted', v_deleted);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

create or replace function public.eliminar_cierre_manual_admin(p_cierre_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cierre record;
  v_area_id uuid;
  v_deleted_reportes int;
  v_deleted_cierres int := 0;
  v_remaining_same_range int := 0;
begin
  if not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Solo administradores pueden eliminar cierres');
  end if;

  select id, area, fecha_inicio, fecha_fin, generado_por, created_at
  into v_cierre
  from public.reportes_generados
  where id = p_cierre_id;

  if v_cierre is null then
    return jsonb_build_object('success', false, 'error', 'No se encontro el cierre o ya fue eliminado');
  end if;

  select id
  into v_area_id
  from public.areas
  where code = v_cierre.area
  limit 1;

  if v_area_id is not null then
    delete from public.cierres_quincenales cq
    where cq.area_id = v_area_id
      and cq.fecha_inicio = v_cierre.fecha_inicio
      and cq.fecha_fin = v_cierre.fecha_fin;

    get diagnostics v_deleted_cierres = row_count;
  end if;

  delete from public.reportes_generados
  where id = p_cierre_id;

  get diagnostics v_deleted_reportes = row_count;

  select count(*)
  into v_remaining_same_range
  from public.reportes_generados rg
  where rg.fecha_inicio = v_cierre.fecha_inicio
    and rg.fecha_fin = v_cierre.fecha_fin
    and rg.generado_por = v_cierre.generado_por;

  if v_remaining_same_range = 0 then
    delete from public.ultimo_cierre_quincenal uc
    where uc.fecha_inicio = v_cierre.fecha_inicio
      and uc.fecha_fin = v_cierre.fecha_fin
      and uc.realizado_por = v_cierre.generado_por;
  end if;

  return jsonb_build_object(
    'success', true,
    'deleted_reportes', v_deleted_reportes,
    'deleted_cierres_quincenales', v_deleted_cierres
  );
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.eliminar_reporte_admin(uuid) to authenticated;
grant execute on function public.eliminar_cierre_manual_admin(uuid) to authenticated;

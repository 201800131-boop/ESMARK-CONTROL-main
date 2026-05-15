-- Cambiar cierres de automáticos a manuales
-- Deshabilita cron automático y crea función manual para que admin inicie el cierre

-- 1) Deshabilitar cron automático para cierres quincenales
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cierre-quincena-15-8am') then
      perform cron.unschedule('cierre-quincena-15-8am');
    end if;
    if exists (select 1 from cron.job where jobname = 'cierre-quincena-30-8am') then
      perform cron.unschedule('cierre-quincena-30-8am');
    end if;
  end if;
exception
  when undefined_function then
    null;
end $$;

-- 2) Crear nueva tabla para rastrear el último cierre
create table if not exists public.ultimo_cierre_quincenal (
  id uuid primary key default gen_random_uuid(),
  fecha_inicio date not null,
  fecha_fin date not null,
  realizado_por uuid not null references public.profiles(id),
  realizado_por_nombre text,
  created_at timestamptz not null default now()
);

-- 3) Función para ejecutar cierre quincenal manualmente (por admin)
create or replace function public.ejecutar_cierre_quincenal_manual(p_realizado_por uuid, p_realizado_por_nombre text default 'admin')
returns jsonb
language plpgsql
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
begin
  -- Verificar que el usuario sea admin
  if not exists (
    select 1 from public.profiles 
    where id = p_realizado_por and rol = 'administracion'
  ) then
    return jsonb_build_object('success', false, 'error', 'Solo administradores pueden ejecutar cierres');
  end if;

  -- Obtener último cierre realizado
  select fecha_fin into ultimo_cierre
  from public.ultimo_cierre_quincenal
  order by created_at desc
  limit 1;

  -- Si no hay cierre previo, usar el primero del mes
  if ultimo_cierre is null then
    f_ini := make_date(extract(year from now())::int, extract(month from now())::int, 1);
  else
    f_ini := (ultimo_cierre).fecha_fin + interval '1 day';
  end if;

  -- La fecha fin es hoy
  f_fin := (timezone('America/Tegucigalpa', now()))::date;

  -- Calcular año, mes y quincena basado en fecha_fin
  v_anio := extract(year from f_fin)::int;
  v_mes := extract(month from f_fin)::int;
  if extract(day from f_fin) <= 15 then
    v_quincena := 1;
  else
    v_quincena := 2;
  end if;

  -- Generar cierre para cada área
  for area_rec in select id from public.areas where code <> 'administracion' loop
    select count(*), coalesce(sum(cantidad_danada),0)
    into t_reg, t_uni
    from public.pedidos_danados
    where fecha between f_ini and f_fin
      and area_id = area_rec.id;

    select count(*)
    into t_act
    from public.actividades
    where (fecha_hora at time zone 'America/Tegucigalpa')::date between f_ini and f_fin
      and area_id = area_rec.id;

    -- Insertar en cierres_quincenales
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
  end loop;

  -- Registrar cierre en tabla de auditoría
  insert into public.ultimo_cierre_quincenal (
    fecha_inicio, fecha_fin, realizado_por, realizado_por_nombre
  ) values (f_ini, f_fin, p_realizado_por, p_realizado_por_nombre);

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

-- 4) RLS para tabla ultimo_cierre_quincenal (admin only)
alter table public.ultimo_cierre_quincenal enable row level security;

drop policy if exists "ultimo_cierre_admin_select" on public.ultimo_cierre_quincenal;
create policy "ultimo_cierre_admin_select"
on public.ultimo_cierre_quincenal
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol = 'administracion'
  )
);

drop policy if exists "ultimo_cierre_admin_insert" on public.ultimo_cierre_quincenal;
create policy "ultimo_cierre_admin_insert"
on public.ultimo_cierre_quincenal
for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol = 'administracion'
  )
);

-- 5) Función de obtener información del próximo cierre
create or replace function public.obtener_info_proximo_cierre()
returns jsonb
language plpgsql
as $$
declare
  ultimo_cierre_rec record;
  f_ini date;
  f_fin date;
  dias_acumulados int;
begin
  -- Obtener último cierre
  select fecha_fin into ultimo_cierre_rec
  from public.ultimo_cierre_quincenal
  order by created_at desc
  limit 1;

  -- Calcular rango del próximo cierre
  if ultimo_cierre_rec is null then
    f_ini := make_date(extract(year from now())::int, extract(month from now())::int, 1);
  else
    f_ini := (ultimo_cierre_rec).fecha_fin + interval '1 day';
  end if;

  f_fin := (timezone('America/Tegucigalpa', now()))::date;
  dias_acumulados := (f_fin - f_ini)::int + 1;

  return jsonb_build_object(
    'fecha_inicio', f_ini,
    'fecha_fin', f_fin,
    'dias_acumulados', dias_acumulados,
    'ultimo_cierre_realizado', 
      case when ultimo_cierre_rec is null then null 
           else ultimo_cierre_rec 
      end
  );
end;
$$;

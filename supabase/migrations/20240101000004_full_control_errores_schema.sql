-- Full schema for Control de Errores ESMARK MEDIA
-- Safe/idempotent migration intended for Supabase Postgres

create extension if not exists pgcrypto;

-- =========================================================
-- 1) Areas
-- =========================================================
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  nombre text not null
);

insert into public.areas (code, nombre)
values
  ('diseno', 'Diseño'),
  ('impresion', 'Impresión'),
  ('sublimacion', 'Sublimación'),
  ('administracion', 'Administración')
on conflict (code) do update set nombre = excluded.nombre;

-- =========================================================
-- 2) Profiles (align existing table if already created)
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  email text unique,
  rol text,
  area_id uuid references public.areas(id),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists nombre text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists rol text;
alter table public.profiles add column if not exists area_id uuid references public.areas(id);

-- Backward compatibility if old column role exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    update public.profiles
    set rol = coalesce(rol, role)
    where rol is null;
  end if;
end $$;

-- Ensure role values are valid in rol.
do $$
begin
  update public.profiles
  set rol = case
    when lower(coalesce(rol, '')) in ('admin', 'administracion') then 'administracion'
    when lower(coalesce(rol, '')) in ('area', 'jefe_area') then 'jefe_area'
    else rol
  end
  where rol is not null;

  begin
    alter table public.profiles
      add constraint profiles_rol_check check (rol in ('jefe_area', 'administracion'));
  exception
    when duplicate_object then null;
  end;
end $$;

-- =========================================================
-- 3) Pedidos danados
-- =========================================================
create table if not exists public.pedidos_danados (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default (timezone('America/Tegucigalpa', now()))::date,
  hora time not null default (timezone('America/Tegucigalpa', now()))::time,
  area_id uuid not null references public.areas(id),
  nombre_pedido text not null,
  cliente text,
  tipo_trabajo text,
  cantidad_danada integer not null check (cantidad_danada > 0),
  motivo_dano text not null,
  observacion text,
  tipo_dano text,
  persona_dano text,
  evidencia_url text,
  estado text not null default 'registrado' check (estado in ('registrado', 'revisado', 'cerrado')),
  registrado_por uuid not null references public.profiles(id),
  trello_card_id text,
  trello_card_name text,
  trello_list_id text,
  trello_list_name text,
  trello_card_pos numeric,
  trello_card_order integer,
  trello_board_id text,
  trello_board_name text,
  fecha_registro timestamptz not null default now()
);

-- Add missing columns if table pre-existed with partial structure.
alter table public.pedidos_danados add column if not exists fecha date not null default (timezone('America/Tegucigalpa', now()))::date;
alter table public.pedidos_danados add column if not exists hora time not null default (timezone('America/Tegucigalpa', now()))::time;
alter table public.pedidos_danados add column if not exists area_id uuid references public.areas(id);
alter table public.pedidos_danados add column if not exists nombre_pedido text;
alter table public.pedidos_danados add column if not exists cliente text;
alter table public.pedidos_danados add column if not exists tipo_trabajo text;
alter table public.pedidos_danados add column if not exists cantidad_danada integer;
alter table public.pedidos_danados add column if not exists motivo_dano text;
alter table public.pedidos_danados add column if not exists observacion text;
alter table public.pedidos_danados add column if not exists tipo_dano text;
alter table public.pedidos_danados add column if not exists persona_dano text;
alter table public.pedidos_danados add column if not exists evidencia_url text;
alter table public.pedidos_danados add column if not exists estado text default 'registrado';
alter table public.pedidos_danados add column if not exists registrado_por uuid references public.profiles(id);
alter table public.pedidos_danados add column if not exists trello_card_name text;
alter table public.pedidos_danados add column if not exists trello_list_name text;
alter table public.pedidos_danados add column if not exists trello_card_pos numeric;
alter table public.pedidos_danados add column if not exists trello_card_order integer;
alter table public.pedidos_danados add column if not exists trello_board_id text;
alter table public.pedidos_danados add column if not exists trello_board_name text;
alter table public.pedidos_danados add column if not exists fecha_registro timestamptz not null default now();

-- =========================================================
-- 4) Actividades
-- =========================================================
create table if not exists public.actividades (
  id uuid primary key default gen_random_uuid(),
  fecha_hora timestamptz not null default now(),
  area_id uuid not null references public.areas(id),
  usuario_id uuid not null references public.profiles(id),
  tipo_actividad text not null,
  descripcion text,
  pedido_danado_id uuid references public.pedidos_danados(id)
);

-- =========================================================
-- 5) Cierres
-- =========================================================
create table if not exists public.cierres_diarios (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  area_id uuid not null references public.areas(id),
  total_registros integer not null default 0,
  total_unidades integer not null default 0,
  total_actividades integer not null default 0,
  estado text not null default 'cerrado_automatico',
  hora_cierre time not null,
  generado_por text not null default 'sistema',
  observacion text,
  created_at timestamptz not null default now(),
  unique (fecha, area_id)
);

create table if not exists public.cierres_quincenales (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  mes integer not null check (mes between 1 and 12),
  quincena integer not null check (quincena in (1,2)),
  fecha_inicio date not null,
  fecha_fin date not null,
  area_id uuid references public.areas(id),
  total_registros integer not null default 0,
  total_unidades integer not null default 0,
  total_actividades integer not null default 0,
  created_at timestamptz not null default now(),
  unique (anio, mes, quincena, area_id)
);

create table if not exists public.cierres_mensuales (
  id uuid primary key default gen_random_uuid(),
  anio integer not null,
  mes integer not null check (mes between 1 and 12),
  area_id uuid references public.areas(id),
  total_registros integer not null default 0,
  total_unidades integer not null default 0,
  total_actividades integer not null default 0,
  created_at timestamptz not null default now(),
  unique (anio, mes, area_id)
);

-- =========================================================
-- 6) Auditoria
-- =========================================================
create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  fecha_hora timestamptz not null default now(),
  usuario_id uuid references public.profiles(id),
  accion text not null,
  modulo text not null,
  detalle jsonb
);

-- =========================================================
-- 7) Trello area mapping
-- =========================================================
create table if not exists public.trello_area_config (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id),
  board_id text not null,
  board_name text,
  list_id text not null,
  list_name text,
  activo boolean not null default true
);

-- =========================================================
-- 8) RLS + policies
-- =========================================================
alter table public.profiles enable row level security;
alter table public.pedidos_danados enable row level security;
alter table public.actividades enable row level security;
alter table public.cierres_diarios enable row level security;

-- profiles
 drop policy if exists "profile_self_select" on public.profiles;
create policy "profile_self_select"
on public.profiles
for select
using (auth.uid() = id);

-- pedidos_danados
 drop policy if exists "pedidos_select_by_area" on public.pedidos_danados;
create policy "pedidos_select_by_area"
on public.pedidos_danados
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.rol = 'administracion'
        or p.area_id = pedidos_danados.area_id
      )
  )
);

 drop policy if exists "pedidos_insert_by_area" on public.pedidos_danados;
create policy "pedidos_insert_by_area"
on public.pedidos_danados
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.rol = 'administracion'
        or p.area_id = pedidos_danados.area_id
      )
  )
);

-- actividades
 drop policy if exists "actividades_select_by_area" on public.actividades;
create policy "actividades_select_by_area"
on public.actividades
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.rol = 'administracion'
        or p.area_id = actividades.area_id
      )
  )
);

-- cierres_diarios (admin only)
drop policy if exists "cierres_admin_only" on public.cierres_diarios;
create policy "cierres_admin_only"
on public.cierres_diarios
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.rol = 'administracion'
  )
);

-- =========================================================
-- 9) Trigger: bloquear registros despues de 4:22 PM
-- =========================================================
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

  if hora_local >= time '16:22:00' then
    raise exception 'El día ya fue cerrado automáticamente a las 4:22 PM';
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

drop trigger if exists trg_validar_hora_registro on public.pedidos_danados;
create trigger trg_validar_hora_registro
before insert on public.pedidos_danados
for each row
execute function public.validar_hora_registro();

-- =========================================================
-- 10) Cierre diario automatico 4:22 PM
-- =========================================================
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
      select count(*), coalesce(sum(cantidad_danada),0)
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
        time '16:22:00',
        'cerrado_automatico',
        'sistema',
        'Cierre automático diario ejecutado por sistema'
      )
      on conflict (fecha, area_id) do nothing;
    end if;
  end loop;
end;
$$;

-- =========================================================
-- 11) Cierre quincenal y mensual
-- =========================================================
create or replace function public.generar_cierre_quincenal(p_anio int, p_mes int, p_quincena int)
returns void
language plpgsql
as $$
declare
  f_ini date;
  f_fin date;
  area_rec record;
  t_reg int;
  t_uni int;
  t_act int;
begin
  if p_quincena = 1 then
    f_ini := make_date(p_anio, p_mes, 1);
    f_fin := make_date(p_anio, p_mes, 15);
  else
    f_ini := make_date(p_anio, p_mes, 16);
    f_fin := (date_trunc('month', make_date(p_anio, p_mes, 1)) + interval '1 month - 1 day')::date;
  end if;

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

    insert into public.cierres_quincenales (
      anio, mes, quincena, fecha_inicio, fecha_fin, area_id,
      total_registros, total_unidades, total_actividades
    ) values (
      p_anio, p_mes, p_quincena, f_ini, f_fin, area_rec.id,
      t_reg, t_uni, t_act
    )
    on conflict (anio, mes, quincena, area_id)
    do update set
      total_registros = excluded.total_registros,
      total_unidades = excluded.total_unidades,
      total_actividades = excluded.total_actividades;
  end loop;
end;
$$;

create or replace function public.generar_cierre_mensual(p_anio int, p_mes int)
returns void
language plpgsql
as $$
declare
  f_ini date;
  f_fin date;
  area_rec record;
  t_reg int;
  t_uni int;
  t_act int;
begin
  f_ini := make_date(p_anio, p_mes, 1);
  f_fin := (date_trunc('month', f_ini) + interval '1 month - 1 day')::date;

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

    insert into public.cierres_mensuales (
      anio, mes, area_id, total_registros, total_unidades, total_actividades
    ) values (
      p_anio, p_mes, area_rec.id, t_reg, t_uni, t_act
    )
    on conflict (anio, mes, area_id)
    do update set
      total_registros = excluded.total_registros,
      total_unidades = excluded.total_unidades,
      total_actividades = excluded.total_actividades;
  end loop;
end;
$$;

-- =========================================================
-- 12) Cron 4:22 PM (if pg_cron available)
-- =========================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cierre-diario-esmark');
    perform cron.schedule(
      'cierre-diario-esmark',
      '22 16 * * *',
      $cron$select public.generar_cierre_diario_automatico();$cron$
    );
  end if;
exception
  when undefined_function then
    null;
end $$;

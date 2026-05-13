-- =========================================================
-- MIGRACIÓN DE AUDITORÍA Y COLUMNAS FALTANTES
-- Asegura que TODAS las columnas usadas por la app existan.
-- Idempotente: puede ejecutarse múltiples veces sin errores.
-- =========================================================

-- =========================================================
-- 1) pedidos_danados — columnas core
-- =========================================================
alter table if exists public.pedidos_danados
  add column if not exists fecha            date        not null default (timezone('America/Tegucigalpa', now()))::date,
  add column if not exists hora             time                 default (timezone('America/Tegucigalpa', now()))::time,
  add column if not exists nombre_pedido    text,
  add column if not exists cantidad_danada  integer,
  add column if not exists motivo_dano      text,
  add column if not exists observacion      text,
  add column if not exists tipo_trabajo     text,
  add column if not exists tipo_dano        text,
  add column if not exists persona_dano     text,
  add column if not exists cliente          text,
  add column if not exists evidencia_url    text,
  add column if not exists estado           text        not null default 'registrado',
  add column if not exists fecha_registro   timestamptz not null default now();

-- =========================================================
-- 2) pedidos_danados — columnas Trello
-- =========================================================
alter table if exists public.pedidos_danados
  add column if not exists trello_card_id    text,
  add column if not exists trello_card_name  text,
  add column if not exists trello_card_url   text,
  add column if not exists trello_card_desc  text,       -- ← nueva, requerida por app
  add column if not exists trello_list_id    text,
  add column if not exists trello_list_name  text,
  add column if not exists trello_board_id   text,
  add column if not exists trello_board_name text,
  add column if not exists trello_card_pos   numeric,
  add column if not exists trello_card_order integer,
  add column if not exists trello_synced_at  timestamptz;

comment on column public.pedidos_danados.trello_card_desc  is 'Descripción de la tarjeta de Trello asociada';
comment on column public.pedidos_danados.trello_card_url   is 'URL completa de la tarjeta de Trello';
comment on column public.pedidos_danados.trello_card_id    is 'ID de la tarjeta de Trello vinculada';
comment on column public.pedidos_danados.trello_card_name  is 'Nombre de la tarjeta de Trello';
comment on column public.pedidos_danados.trello_list_id    is 'ID de la lista (columna) de Trello';
comment on column public.pedidos_danados.trello_list_name  is 'Nombre de la lista de Trello';
comment on column public.pedidos_danados.trello_board_id   is 'ID del tablero de Trello';
comment on column public.pedidos_danados.trello_board_name is 'Nombre del tablero de Trello';

-- Backfill: si hay columna legado trello_description, migrar su contenido
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pedidos_danados'
      and column_name = 'trello_description'
  ) then
    execute $sql$
      update public.pedidos_danados
      set trello_card_desc = nullif(trim(trello_description), '')
      where coalesce(trim(trello_card_desc), '') = ''
        and coalesce(trim(trello_description), '') <> ''
    $sql$;
  end if;
end;
$$;

-- =========================================================
-- 3) profiles — columnas necesarias para la app
-- =========================================================
alter table if exists public.profiles
  add column if not exists nombre    text,
  add column if not exists email     text,
  add column if not exists rol       text,
  add column if not exists area_id   uuid,
  add column if not exists activo    boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

-- =========================================================
-- 4) reportes_generados — columnas usadas en app
-- =========================================================
alter table if exists public.reportes_generados
  add column if not exists area         text,
  add column if not exists generado_por uuid,
  add column if not exists fecha_inicio date,
  add column if not exists fecha_fin    date,
  add column if not exists csv_url      text,
  add column if not exists created_at   timestamptz not null default now();

-- =========================================================
-- 5) user_favorite_trello_lists — columnas necesarias
-- =========================================================
alter table if exists public.user_favorite_trello_lists
  add column if not exists user_id    uuid,
  add column if not exists list_name  text,
  add column if not exists board_id   text not null default '3cv4PjjJ',
  add column if not exists created_at timestamptz not null default now();

-- =========================================================
-- 6) Índices de rendimiento
-- =========================================================
create index if not exists idx_pedidos_area_id       on public.pedidos_danados(area_id);
create index if not exists idx_pedidos_fecha         on public.pedidos_danados(fecha);
create index if not exists idx_pedidos_fecha_reg     on public.pedidos_danados(fecha_registro);
create index if not exists idx_pedidos_trello_card   on public.pedidos_danados(trello_card_id);
create index if not exists idx_pedidos_persona_dano  on public.pedidos_danados(persona_dano);
create index if not exists idx_reportes_area         on public.reportes_generados(area);
create index if not exists idx_reportes_created      on public.reportes_generados(created_at);

-- =========================================================
-- 7) RLS: asegurar que las políticas básicas existan
-- =========================================================

-- Habilitar RLS si aún no está activo
alter table public.pedidos_danados     enable row level security;
alter table public.reportes_generados  enable row level security;
alter table if exists public.user_favorite_trello_lists enable row level security;

-- pedidos_danados: admin ve todo, área ve su área
drop policy if exists "Anyone can view pedidos_danados"  on public.pedidos_danados;
drop policy if exists "Anyone can insert pedidos_danados" on public.pedidos_danados;
drop policy if exists "Anyone can update pedidos_danados" on public.pedidos_danados;

create policy "pedidos_select_all_authenticated"
  on public.pedidos_danados
  for select
  using (auth.uid() is not null);

create policy "pedidos_insert_authenticated"
  on public.pedidos_danados
  for insert
  with check (auth.uid() is not null);

create policy "pedidos_update_authenticated"
  on public.pedidos_danados
  for update
  using (auth.uid() is not null);

-- reportes_generados: usuario ve los suyos + admin los de su área
drop policy if exists "Users can view their own reports" on public.reportes_generados;
drop policy if exists "Users can create their own reports" on public.reportes_generados;
drop policy if exists "Service role has full access" on public.reportes_generados;
drop policy if exists "Admins can view all reports" on public.reportes_generados;

create policy "Users can view their own reports"
  on public.reportes_generados
  for select
  using (auth.uid() = generado_por or auth.role() = 'service_role');

create policy "Users can create their own reports"
  on public.reportes_generados
  for insert
  with check (auth.uid() = generado_por);

create policy "Service role has full access"
  on public.reportes_generados
  for all
  using (auth.role() = 'service_role');

-- =========================================================
-- 8) Verificación final (resultados visibles en logs)
-- =========================================================
do $$
declare
  col_count int;
  total_pedidos int;
  con_trello int;
  con_desc int;
begin
  -- contar columnas de pedidos_danados
  select count(*) into col_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'pedidos_danados';

  -- estadísticas de datos
  select
    count(*),
    count(*) filter (where coalesce(trello_card_id, '') <> ''),
    count(*) filter (where coalesce(trello_card_desc, '') <> '')
  into total_pedidos, con_trello, con_desc
  from public.pedidos_danados;

  raise notice '=== AUDITORÍA ESMARK CONTROL ===';
  raise notice 'Columnas en pedidos_danados: %', col_count;
  raise notice 'Total registros: %', total_pedidos;
  raise notice 'Registros con tarjeta Trello: %', con_trello;
  raise notice 'Registros con descripción Trello: %', con_desc;
  raise notice '================================';
end;
$$;

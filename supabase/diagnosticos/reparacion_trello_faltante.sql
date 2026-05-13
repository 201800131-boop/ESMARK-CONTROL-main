-- Reparacion y clasificacion de metadata Trello en pedidos_danados.
-- Ejecutar en Supabase SQL Editor.

-- =========================================================
-- 1) Reparar URL de Trello cuando existe trello_card_id
-- =========================================================
-- Regla:
-- - Si trello_card_id tiene valor y trello_card_url esta vacio, construir URL canonica:
--   https://trello.com/c/<trello_card_id>
--
-- Nota:
-- - Se ejecuta via SQL dinamico para no fallar si alguna columna no existe en entornos mixtos.

do $$
declare
  has_card_id boolean;
  has_card_url boolean;
  updated_count integer := 0;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pedidos_danados'
      and column_name = 'trello_card_id'
  ) into has_card_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pedidos_danados'
      and column_name = 'trello_card_url'
  ) into has_card_url;

  if has_card_id and has_card_url then
    execute $sql$
      update public.pedidos_danados
      set trello_card_url = 'https://trello.com/c/' || btrim(trello_card_id)
      where nullif(btrim(trello_card_id), '') is not null
        and nullif(btrim(trello_card_url), '') is null
    $sql$;

    get diagnostics updated_count = row_count;
    raise notice 'URLs Trello reparadas: %', updated_count;
  else
    raise notice 'Se omite reparacion: faltan columnas trello_card_id y/o trello_card_url.';
  end if;
end $$;

-- =========================================================
-- 2) Vista de calidad de metadata Trello
-- =========================================================
-- Crea una vista que clasifica cada registro en:
-- - SIN_TARJETA_REAL: no hay ninguna evidencia Trello.
-- - DATO_INCOMPLETO: hay algo Trello, pero falta ID y URL.
-- - COMPLETO: hay ID o URL (con suficientes datos para abrir/referenciar tarjeta).

create or replace view public.vw_pedidos_trello_calidad as
with base as (
  select
    p.id,
    to_jsonb(p) as j
  from public.pedidos_danados p
), normalizado as (
  select
    b.id,
    coalesce(
      nullif(b.j->>'fecha', ''),
      left(nullif(b.j->>'fecha_registro', ''), 10)
    ) as fecha_ref,
    nullif(b.j->>'area_id', '') as area_id_text,
    nullif(b.j->>'nombre_pedido', '') as nombre_pedido,
    nullif(b.j->>'motivo_dano', '') as motivo_dano,
    nullif(b.j->>'trello_card_id', '') as trello_card_id,
    nullif(b.j->>'trello_card_name', '') as trello_card_name,
    nullif(b.j->>'trello_card_url', '') as trello_card_url,
    nullif(b.j->>'trello_list_id', '') as trello_list_id,
    nullif(b.j->>'trello_list_name', '') as trello_list_name,
    nullif(b.j->>'trello_board_id', '') as trello_board_id,
    nullif(b.j->>'trello_board_name', '') as trello_board_name
  from base b
)
select
  n.id,
  n.fecha_ref as fecha,
  coalesce(a.code, n.area_id_text, 'sin_area') as area,
  n.nombre_pedido,
  n.motivo_dano,
  n.trello_card_id,
  n.trello_card_name,
  n.trello_card_url,
  n.trello_list_id,
  n.trello_list_name,
  n.trello_board_id,
  n.trello_board_name,
  case
    when coalesce(
      n.trello_card_id,
      n.trello_card_name,
      n.trello_card_url,
      n.trello_list_id,
      n.trello_list_name,
      n.trello_board_id,
      n.trello_board_name
    ) is null then 'SIN_TARJETA_REAL'
    when coalesce(n.trello_card_id, n.trello_card_url) is null then 'DATO_INCOMPLETO'
    else 'COMPLETO'
  end as estado_trello
from normalizado n
left join public.areas a
  on a.id::text = n.area_id_text;

comment on view public.vw_pedidos_trello_calidad is
'Clasifica calidad de metadata Trello de pedidos_danados: SIN_TARJETA_REAL, DATO_INCOMPLETO, COMPLETO.';

-- =========================================================
-- 3) Consultas rapidas de uso
-- =========================================================
-- 3.1 Conteo por estado y area
-- select area, estado_trello, count(*) as total
-- from public.vw_pedidos_trello_calidad
-- group by area, estado_trello
-- order by area, estado_trello;

-- 3.2 Detalle de incompletos para correccion manual
-- select *
-- from public.vw_pedidos_trello_calidad
-- where estado_trello = 'DATO_INCOMPLETO'
-- order by fecha desc nulls last, area, nombre_pedido;

-- 3.3 Detalle sin tarjeta real
-- select *
-- from public.vw_pedidos_trello_calidad
-- where estado_trello = 'SIN_TARJETA_REAL'
-- order by fecha desc nulls last, area, nombre_pedido;

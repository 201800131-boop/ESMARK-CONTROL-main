-- Auditoria de registros sin metadata de Trello en public.pedidos_danados.
-- Compatible con esquemas mixtos: usa to_jsonb(p) para leer claves aunque algunas columnas no existan.
-- Ejecutar en Supabase SQL Editor.

-- 1) Detalle de registros sin informacion Trello.
with pedidos as (
  select
    p.id,
    to_jsonb(p) as j
  from public.pedidos_danados p
), normalizado as (
  select
    pe.id,
    pe.j,
    coalesce(
      nullif(pe.j->>'fecha', ''),
      left(nullif(pe.j->>'fecha_registro', ''), 10)
    ) as fecha_ref,
    nullif(pe.j->>'trello_card_id', '') as trello_card_id,
    nullif(pe.j->>'trello_card_name', '') as trello_card_name,
    nullif(pe.j->>'trello_card_url', '') as trello_card_url,
    nullif(pe.j->>'trello_list_id', '') as trello_list_id,
    nullif(pe.j->>'trello_list_name', '') as trello_list_name,
    nullif(pe.j->>'trello_board_id', '') as trello_board_id,
    nullif(pe.j->>'trello_board_name', '') as trello_board_name,
    nullif(pe.j->>'nombre_pedido', '') as nombre_pedido,
    nullif(pe.j->>'motivo_dano', '') as motivo_dano,
    nullif(pe.j->>'area_id', '') as area_id_text
  from pedidos pe
)
select
  n.id,
  n.fecha_ref as fecha,
  coalesce(a.code, n.area_id_text, 'sin_area') as area,
  n.nombre_pedido,
  n.motivo_dano,
  coalesce(n.trello_card_id, n.trello_card_name, n.trello_card_url, n.trello_list_id, n.trello_list_name, n.trello_board_id, n.trello_board_name) as evidencia_trello,
  case
    when coalesce(n.trello_card_id, n.trello_card_name, n.trello_card_url, n.trello_list_id, n.trello_list_name, n.trello_board_id, n.trello_board_name) is null
      then 'SIN METADATA TRELLO'
    else 'CON METADATA TRELLO'
  end as estado_trello
from normalizado n
left join public.areas a
  on a.id::text = n.area_id_text
where coalesce(n.trello_card_id, n.trello_card_name, n.trello_card_url, n.trello_list_id, n.trello_list_name, n.trello_board_id, n.trello_board_name) is null
order by n.fecha_ref desc nulls last, area, n.nombre_pedido;

-- 2) Resumen por area: cuantos registros carecen de metadata Trello.
with pedidos as (
  select
    to_jsonb(p) as j
  from public.pedidos_danados p
), normalizado as (
  select
    coalesce(
      nullif(j->>'fecha', ''),
      left(nullif(j->>'fecha_registro', ''), 10)
    ) as fecha_ref,
    nullif(j->>'area_id', '') as area_id_text,
    coalesce(
      nullif(j->>'trello_card_id', ''),
      nullif(j->>'trello_card_name', ''),
      nullif(j->>'trello_card_url', ''),
      nullif(j->>'trello_list_id', ''),
      nullif(j->>'trello_list_name', ''),
      nullif(j->>'trello_board_id', ''),
      nullif(j->>'trello_board_name', '')
    ) as evidencia_trello
  from pedidos
)
select
  coalesce(a.code, n.area_id_text, 'sin_area') as area,
  count(*) as total_sin_trello,
  min(n.fecha_ref) as primer_registro,
  max(n.fecha_ref) as ultimo_registro
from normalizado n
left join public.areas a
  on a.id::text = n.area_id_text
where n.evidencia_trello is null
group by coalesce(a.code, n.area_id_text, 'sin_area')
order by total_sin_trello desc, area;

-- 3) Resumen diario para detectar periodos con mayor impacto.
with pedidos as (
  select
    to_jsonb(p) as j
  from public.pedidos_danados p
), normalizado as (
  select
    coalesce(
      nullif(j->>'fecha', ''),
      left(nullif(j->>'fecha_registro', ''), 10)
    ) as fecha_ref,
    coalesce(
      nullif(j->>'trello_card_id', ''),
      nullif(j->>'trello_card_name', ''),
      nullif(j->>'trello_card_url', ''),
      nullif(j->>'trello_list_id', ''),
      nullif(j->>'trello_list_name', ''),
      nullif(j->>'trello_board_id', ''),
      nullif(j->>'trello_board_name', '')
    ) as evidencia_trello
  from pedidos
)
select
  fecha_ref as fecha,
  count(*) as total_sin_trello
from normalizado
where evidencia_trello is null
group by fecha_ref
order by fecha_ref desc nulls last;

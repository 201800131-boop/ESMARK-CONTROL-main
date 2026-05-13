-- Agrega y normaliza la descripción de la tarjeta de Trello en pedidos_danados.
-- Idempotente: puede ejecutarse múltiples veces sin romper.

alter table if exists public.pedidos_danados
  add column if not exists trello_card_desc text;

comment on column public.pedidos_danados.trello_card_desc is 'Descripción de la tarjeta de Trello asociada';

do $$
begin
  -- Si existe una columna legacy trello_description, migrar su contenido.
  if exists (
    select 1
    from information_schema.columns
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

-- Verificación rápida tras aplicar:
-- select
--   count(*) as total_registros,
--   count(*) filter (where coalesce(trim(trello_card_desc), '') <> '') as con_descripcion
-- from public.pedidos_danados;

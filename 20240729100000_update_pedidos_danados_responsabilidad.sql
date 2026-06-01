-- MIGRACIÓN PARA ESTRUCTURAR LA RESPONSABILIDAD EN PEDIDOS DAÑADOS
-- Cambia el campo de texto libre 'persona_dano' por un sistema estructurado
-- con tipo y detalle de responsabilidad.

-- 1. Añadir la nueva columna para el tipo de responsabilidad ('persona', 'area', 'tecnico', 'otro').
alter table public.pedidos_danados
  add column if not exists responsabilidad_tipo text;

-- 2. Renombrar la columna existente 'persona_dano' a 'responsabilidad_detalle'.
--    Esto preserva los datos que ya existen en esa columna.
alter table if exists public.pedidos_danados
  rename column persona_dano to responsabilidad_detalle;

-- 3. (Opcional) Actualizar los registros antiguos para que tengan un tipo por defecto.
--    Asumimos que todos los registros anteriores se referían a una 'persona'.
update public.pedidos_danados
set responsabilidad_tipo = 'persona'
where responsabilidad_detalle is not null and responsabilidad_tipo is null;
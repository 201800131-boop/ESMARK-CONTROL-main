-- Habilita eventos Realtime para reportes y pedidos dañados.
-- Replica identity full permite que los DELETE/UPDATE emitan suficiente información.

alter table if exists public.pedidos_danados replica identity full;
alter table if exists public.reportes_generados replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.pedidos_danados;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.reportes_generados;
exception
  when duplicate_object then null;
end $$;

-- Permite que los usuarios de area resuelvan su area desde la app.
-- Sin esta lectura, PedidosDanadosScreen no puede obtener area_id y muestra
-- que no hay areas configuradas aunque la tabla si tenga datos.

alter table public.areas enable row level security;

drop policy if exists "areas_select_authenticated" on public.areas;
create policy "areas_select_authenticated"
on public.areas
for select
to authenticated
using (auth.uid() is not null);

grant select on table public.areas to authenticated;

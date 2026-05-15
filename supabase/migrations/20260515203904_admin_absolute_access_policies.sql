-- Garantiza acceso absoluto para todo usuario con rol administrador.
-- La app guarda el rol en Auth metadata y algunas instalaciones tambien usan
-- public.profiles; la funcion public.is_current_user_admin() centraliza ambas.

alter table public.actividades enable row level security;
alter table public.areas enable row level security;
alter table public.auditoria enable row level security;
alter table public.cierres_diarios enable row level security;
alter table public.cierres_mensuales enable row level security;
alter table public.cierres_quincenales enable row level security;
alter table public.pedidos_danados enable row level security;
alter table public.profiles enable row level security;
alter table public.reportes_generados enable row level security;
alter table public.trello_area_config enable row level security;
alter table public.ultimo_cierre_quincenal enable row level security;
alter table public.user_favorite_trello_lists enable row level security;

drop policy if exists "admin_absolute_actividades" on public.actividades;
create policy "admin_absolute_actividades"
on public.actividades
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_areas" on public.areas;
create policy "admin_absolute_areas"
on public.areas
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_auditoria" on public.auditoria;
create policy "admin_absolute_auditoria"
on public.auditoria
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_cierres_diarios" on public.cierres_diarios;
create policy "admin_absolute_cierres_diarios"
on public.cierres_diarios
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_cierres_mensuales" on public.cierres_mensuales;
create policy "admin_absolute_cierres_mensuales"
on public.cierres_mensuales
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_cierres_quincenales" on public.cierres_quincenales;
create policy "admin_absolute_cierres_quincenales"
on public.cierres_quincenales
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_pedidos_danados" on public.pedidos_danados;
create policy "admin_absolute_pedidos_danados"
on public.pedidos_danados
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_profiles" on public.profiles;
create policy "admin_absolute_profiles"
on public.profiles
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_reportes_generados" on public.reportes_generados;
create policy "admin_absolute_reportes_generados"
on public.reportes_generados
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_trello_area_config" on public.trello_area_config;
create policy "admin_absolute_trello_area_config"
on public.trello_area_config
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_ultimo_cierre_quincenal" on public.ultimo_cierre_quincenal;
create policy "admin_absolute_ultimo_cierre_quincenal"
on public.ultimo_cierre_quincenal
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "admin_absolute_user_favorite_trello_lists" on public.user_favorite_trello_lists;
create policy "admin_absolute_user_favorite_trello_lists"
on public.user_favorite_trello_lists
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

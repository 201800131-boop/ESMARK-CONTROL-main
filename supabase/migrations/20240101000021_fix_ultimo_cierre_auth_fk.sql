-- Permite que ultimo_cierre_quincenal apunte al usuario real de Supabase Auth.
-- En esta instalacion public.profiles puede estar vacia, pero auth.users contiene
-- los usuarios que inician sesion en la app.

alter table public.ultimo_cierre_quincenal
  drop constraint if exists ultimo_cierre_quincenal_realizado_por_fkey;

alter table public.ultimo_cierre_quincenal
  add constraint ultimo_cierre_quincenal_realizado_por_fkey
  foreign key (realizado_por)
  references auth.users(id)
  on delete cascade;

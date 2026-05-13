-- Migration: add_last_seen_to_profiles
-- Agrega columna last_seen para presencia en tiempo real

alter table public.profiles
  add column if not exists last_seen timestamptz;

-- Índice para consultas de usuarios conectados recientemente
create index if not exists idx_profiles_last_seen on public.profiles(last_seen desc);

-- Habilitar Realtime en la tabla profiles (necesario para suscripciones)
alter publication supabase_realtime add table public.profiles;

comment on column public.profiles.last_seen is 'Última vez activo en la plataforma (heartbeat cada 30s)';

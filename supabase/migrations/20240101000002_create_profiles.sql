-- Tabla de perfiles de usuario: vincula auth.users con username y rol
create table if not exists public.profiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  username  text not null unique,
  role      text not null default 'area' check (role in ('admin', 'area')),
  activo    boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cualquier usuario autenticado puede leer su propio perfil
drop policy if exists "Leer perfil propio" on public.profiles;
create policy "Leer perfil propio"
  on public.profiles for select
  using (auth.uid() = id);

-- El admin puede leer todos los perfiles
drop policy if exists "Admin lee todos los perfiles" on public.profiles;
create policy "Admin lee todos los perfiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- El admin puede insertar perfiles
drop policy if exists "Admin inserta perfiles" on public.profiles;
create policy "Admin inserta perfiles"
  on public.profiles for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- El admin puede actualizar perfiles
drop policy if exists "Admin actualiza perfiles" on public.profiles;
create policy "Admin actualiza perfiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

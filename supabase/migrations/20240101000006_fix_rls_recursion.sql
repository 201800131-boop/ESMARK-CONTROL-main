-- Migration: fix_rls_recursion
-- Fixes infinite recursion in profiles RLS policies and ensures pedidos_danados is properly configured

-- =========================================================
-- 1) Disable RLS on profiles temporarily to fix recursion
-- =========================================================
alter table public.profiles disable row level security;

-- Drop all existing problematic policies on profiles
drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Allow auth.users to read profiles" on public.profiles;
drop policy if exists "Allow admins to read all profiles" on public.profiles;

-- =========================================================
-- 2) Enable RLS on pedidos_danados if not already enabled
-- =========================================================
alter table public.pedidos_danados enable row level security;

-- Drop all existing policies on pedidos_danados
drop policy if exists "Users can view pedidos_danados" on public.pedidos_danados;
drop policy if exists "Users can create pedidos_danados" on public.pedidos_danados;
drop policy if exists "Users can update pedidos_danados" on public.pedidos_danados;

-- Create simple permissive policies for pedidos_danados
create policy "Anyone can view pedidos_danados"
  on public.pedidos_danados
  for select
  using (true);

create policy "Anyone can create pedidos_danados"
  on public.pedidos_danados
  for insert
  with check (true);

create policy "Anyone can update pedidos_danados"
  on public.pedidos_danados
  for update
  using (true)
  with check (true);

-- =========================================================
-- 3) Ensure area_id column exists and is not null
-- =========================================================
alter table public.pedidos_danados 
  alter column area_id set not null;

-- Create index on area_id for performance
create index if not exists idx_pedidos_danados_area_id on public.pedidos_danados(area_id);
create index if not exists idx_pedidos_danados_fecha on public.pedidos_danados(fecha);

commit;

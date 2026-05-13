-- User Favorite Trello Lists
-- Guardar favoritos de clasificaciones de Trello por usuario (RLS)

create table if not exists public.user_favorite_trello_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_name text not null,
  board_id text not null default '3cv4PjjJ',
  created_at timestamptz not null default now(),
  unique(user_id, list_name, board_id)
);

-- Crear índice para búsquedas rápidas por usuario
create index if not exists idx_user_fav_lists_user_id on public.user_favorite_trello_lists(user_id);
create index if not exists idx_user_fav_lists_board_id on public.user_favorite_trello_lists(board_id);

-- =========================================================
-- RLS (Row Level Security)
-- =========================================================
alter table public.user_favorite_trello_lists enable row level security;

-- Política: Usuarios solo pueden ver sus propios favoritos
create policy "Users can view own favorite trello lists"
  on public.user_favorite_trello_lists
  for select
  using (auth.uid() = user_id);

-- Política: Usuarios solo pueden insertar sus propios favoritos
-- Se permite que el cliente especifique user_id, pero solo si coincide con auth.uid()
create policy "Users can insert own favorite trello lists"
  on public.user_favorite_trello_lists
  for insert
  with check (
    (user_id = auth.uid())
    or 
    (auth.uid() is not null and user_id is null)
  );

-- Política: Usuarios solo pueden eliminar sus propios favoritos
create policy "Users can delete own favorite trello lists"
  on public.user_favorite_trello_lists
  for delete
  using (auth.uid() = user_id);

-- Política: Usuarios solo pueden actualizar sus propios favoritos
create policy "Users can update own favorite trello lists"
  on public.user_favorite_trello_lists
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger para asignar automáticamente user_id si no se proporciona
create or replace function public.set_user_id_for_favorites()
returns trigger as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_set_user_id_for_favorites
  before insert on public.user_favorite_trello_lists
  for each row
  execute function public.set_user_id_for_favorites();


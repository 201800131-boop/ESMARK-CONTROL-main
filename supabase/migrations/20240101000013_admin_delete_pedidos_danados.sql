-- Permite que solo administradores eliminen reportes de pedidos dañados.

alter table public.pedidos_danados enable row level security;

drop policy if exists "pedidos_delete_admin" on public.pedidos_danados;

create policy "pedidos_delete_admin"
  on public.pedidos_danados
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

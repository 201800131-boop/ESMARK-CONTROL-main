-- Permite que administradores eliminen cierres guardados en reportes_generados.

alter table public.reportes_generados enable row level security;

drop policy if exists "reportes_generados_delete_admin" on public.reportes_generados;

create policy "reportes_generados_delete_admin"
  on public.reportes_generados
  for delete
  to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- RLS por area para reportes_generados:
-- - admin ve todo
-- - usuarios area solo ven/insertan su area

alter table public.reportes_generados enable row level security;

drop policy if exists "Users can view their own reports" on public.reportes_generados;
drop policy if exists "Users can create their own reports" on public.reportes_generados;
drop policy if exists "Admin can view all reports" on public.reportes_generados;
drop policy if exists "Area users can view their area reports" on public.reportes_generados;
drop policy if exists "Admin can insert reports" on public.reportes_generados;
drop policy if exists "Area users can insert reports of their area" on public.reportes_generados;

create policy "Admin can view all reports"
  on public.reportes_generados
  for select
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "Area users can view their area reports"
  on public.reportes_generados
  for select
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'area'
    and area = (auth.jwt() -> 'user_metadata' ->> 'area')
  );

create policy "Admin can insert reports"
  on public.reportes_generados
  for insert
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "Area users can insert reports of their area"
  on public.reportes_generados
  for insert
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'area'
    and area = (auth.jwt() -> 'user_metadata' ->> 'area')
  );

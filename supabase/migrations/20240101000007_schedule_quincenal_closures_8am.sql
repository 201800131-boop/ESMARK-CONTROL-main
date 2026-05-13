-- Schedule quincenal closures at 08:00 AM on days 15 and 30.
-- Uses existing function public.generar_cierre_quincenal(anio, mes, quincena)

create extension if not exists pg_cron;

-- Wrapper for first quincena (1-15)
create or replace function public.run_cierre_quincena_1_automatico()
returns void
language plpgsql
as $$
begin
  perform public.generar_cierre_quincenal(
    extract(year from timezone('America/Tegucigalpa', now()))::int,
    extract(month from timezone('America/Tegucigalpa', now()))::int,
    1
  );
end;
$$;

-- Wrapper for second quincena (16-30/31)
create or replace function public.run_cierre_quincena_2_automatico()
returns void
language plpgsql
as $$
begin
  perform public.generar_cierre_quincenal(
    extract(year from timezone('America/Tegucigalpa', now()))::int,
    extract(month from timezone('America/Tegucigalpa', now()))::int,
    2
  );
end;
$$;

-- Recreate jobs safely
select cron.unschedule('cierre-quincena-15-8am') where exists (
  select 1 from cron.job where jobname = 'cierre-quincena-15-8am'
);

select cron.unschedule('cierre-quincena-30-8am') where exists (
  select 1 from cron.job where jobname = 'cierre-quincena-30-8am'
);

-- Day 15 at 08:00 AM
select cron.schedule(
  'cierre-quincena-15-8am',
  '0 8 15 * *',
  $$select public.run_cierre_quincena_1_automatico();$$
);

-- Day 30 at 08:00 AM
select cron.schedule(
  'cierre-quincena-30-8am',
  '0 8 30 * *',
  $$select public.run_cierre_quincena_2_automatico();$$
);

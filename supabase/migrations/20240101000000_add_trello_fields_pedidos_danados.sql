-- Migration: add_trello_fields_pedidos_danados
-- Adds Trello integration columns to the pedidos_danados table.

create extension if not exists pgcrypto;

create table if not exists public.pedidos_danados (
  id uuid primary key default gen_random_uuid()
);

alter table public.pedidos_danados
  add column if not exists trello_card_id   text,
  add column if not exists trello_card_url  text,
  add column if not exists trello_list_id   text,
  add column if not exists trello_synced_at timestamptz;

comment on column public.pedidos_danados.trello_card_id   is 'Trello card short ID linked to this damaged order';
comment on column public.pedidos_danados.trello_card_url  is 'Full URL of the Trello card';
comment on column public.pedidos_danados.trello_list_id   is 'Trello list (column) ID where the card lives';
comment on column public.pedidos_danados.trello_synced_at is 'Timestamp of the last successful Trello sync';

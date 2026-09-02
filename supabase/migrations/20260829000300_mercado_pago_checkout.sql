-- Checkout Mercado Pago + automacao de pedidos no Bling.
-- Execute uma vez no SQL Editor do Supabase antes de publicar as funcoes.

alter table public.pedidos
  add column if not exists referencia text unique,
  add column if not exists status_pagamento text not null default 'pendente',
  add column if not exists mercado_pago_preference_id text unique,
  add column if not exists mercado_pago_payment_id text unique,
  add column if not exists mercado_pago_status text,
  add column if not exists itens_json jsonb,
  add column if not exists cliente_nome text,
  add column if not exists cliente_telefone text,
  add column if not exists cliente_email text,
  add column if not exists atualizado_em timestamptz not null default now(),
  add column if not exists bling_id text unique,
  add column if not exists bling_sincronizado_em timestamptz,
  add column if not exists bling_erro text;

create index if not exists pedidos_referencia_idx on public.pedidos (referencia);
create index if not exists pedidos_mp_payment_idx on public.pedidos (mercado_pago_payment_id);

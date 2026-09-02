-- Integração Tio Nan ↔ Bling
-- Execute este arquivo uma vez no SQL Editor do Supabase.

create table if not exists public.bling_integracao (
  id text primary key default 'principal' check (id = 'principal'),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  oauth_state text,
  oauth_state_expires_at timestamptz,
  conectado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.bling_integracao enable row level security;

alter table public.produtos
  add column if not exists bling_id text unique,
  add column if not exists bling_sincronizado_em timestamptz;

alter table public.clientes
  add column if not exists bling_id text unique,
  add column if not exists bling_sincronizado_em timestamptz;

comment on table public.bling_integracao is
  'Tokens do Bling. Não crie políticas públicas para esta tabela.';

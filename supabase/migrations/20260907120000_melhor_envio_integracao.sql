create table if not exists public.melhor_envio_integracao (
  id text primary key,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.melhor_envio_integracao enable row level security;

revoke all on table public.melhor_envio_integracao from anon, authenticated;


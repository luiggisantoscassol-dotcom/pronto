alter table public.clientes
  add column if not exists marketing_consentimento boolean not null default false,
  add column if not exists marketing_consentido_em timestamptz,
  add column if not exists marketing_origem text;

create table if not exists public.email_campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  assunto text not null,
  preheader text,
  conteudo text not null,
  imagem_url text,
  botao_texto text,
  botao_url text,
  status text not null default 'rascunho' check (status in ('rascunho','enviando','enviada','erro')),
  destinatarios integer not null default 0,
  resend_segment_id text,
  resend_broadcast_id text,
  erro text,
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);

alter table public.email_campanhas enable row level security;

drop policy if exists email_campanhas_admin_only on public.email_campanhas;
create policy email_campanhas_admin_only on public.email_campanhas
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create index if not exists clientes_marketing_email_idx
  on public.clientes (lower(email))
  where marketing_consentimento = true and email is not null;

create index if not exists email_campanhas_criado_em_idx
  on public.email_campanhas (criado_em desc);

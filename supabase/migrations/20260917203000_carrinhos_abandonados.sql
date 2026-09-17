-- Recuperação automática de carrinhos com consentimento explícito no checkout.
create table if not exists public.carrinhos_abandonados (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique,
  email text not null,
  nome text,
  itens jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  consentimento boolean not null default false,
  status text not null default 'ativo',
  ultima_atividade_em timestamptz not null default now(),
  enviar_apos timestamptz not null default (now() + interval '2 hours'),
  enviado_em timestamptz,
  recuperado_em timestamptz,
  convertido_em timestamptz,
  resend_id text,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint carrinhos_abandonados_status_check
    check (status in ('ativo', 'enviando', 'enviado', 'convertido', 'cancelado', 'erro'))
);

create index if not exists carrinhos_abandonados_pendentes_idx
  on public.carrinhos_abandonados (enviar_apos)
  where status in ('ativo', 'erro') and consentimento = true and enviado_em is null;

alter table public.carrinhos_abandonados enable row level security;
revoke all on table public.carrinhos_abandonados from anon, authenticated;

drop policy if exists carrinhos_abandonados_admin_only on public.carrinhos_abandonados;
create policy carrinhos_abandonados_admin_only on public.carrinhos_abandonados
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

alter table public.pedidos
  add column if not exists carrinho_recuperacao_token uuid;

create index if not exists pedidos_carrinho_recuperacao_token_idx
  on public.pedidos (carrinho_recuperacao_token)
  where carrinho_recuperacao_token is not null;

-- O segredo é criado no banco e nunca fica exposto no navegador ou no repositório.
create table if not exists public.automacao_segredos (
  nome text primary key,
  valor uuid not null default gen_random_uuid(),
  criado_em timestamptz not null default now()
);
alter table public.automacao_segredos enable row level security;
revoke all on table public.automacao_segredos from anon, authenticated;
drop policy if exists automacao_segredos_admin_only on public.automacao_segredos;
create policy automacao_segredos_admin_only on public.automacao_segredos
for all to authenticated
using (public.is_admin())
with check (public.is_admin());
insert into public.automacao_segredos (nome)
values ('carrinho_abandonado_cron')
on conflict (nome) do nothing;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
declare
  job record;
begin
  for job in select jobid from cron.job where jobname = 'tio-nan-carrinhos-abandonados'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

select cron.schedule(
  'tio-nan-carrinhos-abandonados',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := 'https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/carrinho-abandonado',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'action', 'processar',
        'cron_token', (select valor::text from public.automacao_segredos where nome = 'carrinho_abandonado_cron')
      )
    );
  $cron$
);

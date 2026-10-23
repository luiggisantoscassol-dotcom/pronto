create table if not exists public.consignacao_backups (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'automatico' check (origem in ('automatico','manual')),
  status text not null default 'processando' check (status in ('processando','concluido','erro')),
  arquivo_id text,
  arquivo_nome text,
  arquivo_url text,
  total_empresas integer not null default 0,
  total_movimentos integer not null default 0,
  total_pagamentos integer not null default 0,
  total_auditoria integer not null default 0,
  tamanho_bytes bigint,
  integridade_sha256 text,
  mensagem_erro text,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null
);
create index if not exists consignacao_backups_criado_idx on public.consignacao_backups(iniciado_em desc);
alter table public.consignacao_backups enable row level security;
alter table public.consignacao_backups force row level security;
drop policy if exists "admin leitura backups consignacao" on public.consignacao_backups;
create policy "admin leitura backups consignacao" on public.consignacao_backups for select to authenticated using (public.is_admin());
revoke all on public.consignacao_backups from public,anon,authenticated;
grant select on public.consignacao_backups to authenticated;
comment on table public.consignacao_backups is 'Historico dos backups integrais da consignacao enviados ao Google Drive privado.';

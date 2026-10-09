-- Auditoria dos backups integrais do Livro de Selos enviados ao Google Drive.
-- A tabela guarda somente metadados; o arquivo permanece na pasta privada do Drive.
create table if not exists public.livro_selos_backups (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'automatico' check (origem in ('automatico','manual')),
  status text not null default 'processando' check (status in ('processando','concluido','erro')),
  arquivo_id text,
  arquivo_nome text,
  arquivo_url text,
  total_lancamentos integer not null default 0,
  total_tipos_selo integer not null default 0,
  tamanho_bytes bigint,
  integridade_sha256 text,
  mensagem_erro text,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null
);

create index if not exists livro_selos_backups_criado_idx
  on public.livro_selos_backups (iniciado_em desc);

alter table public.livro_selos_backups enable row level security;
drop policy if exists livro_selos_backups_admin_select on public.livro_selos_backups;
create policy livro_selos_backups_admin_select on public.livro_selos_backups
for select to authenticated using (public.is_admin());

comment on table public.livro_selos_backups is
  'Histórico e integridade dos backups do Livro Modelo 4 enviados ao Google Drive.';

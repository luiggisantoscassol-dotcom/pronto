-- Auditoria de reprocessamentos e rascunhos de NF-e de entrada propria.

create table if not exists public.bling_reprocessamentos (
  id uuid primary key default gen_random_uuid(),
  origem_tipo text not null check (origem_tipo in ('envase','consignacao','pedido','nfe_pedido','backup_selos','contabilidade')),
  origem_id text not null,
  acao text not null,
  status text not null default 'processando' check (status in ('processando','concluido','erro','conferencia')),
  tentativa integer not null default 1,
  erro text,
  resposta jsonb not null default '{}'::jsonb,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create index if not exists bling_reprocessamentos_origem_idx
  on public.bling_reprocessamentos(origem_tipo, origem_id, criado_em desc);

alter table public.bling_reprocessamentos enable row level security;
drop policy if exists bling_reprocessamentos_admin on public.bling_reprocessamentos;
create policy bling_reprocessamentos_admin on public.bling_reprocessamentos
  for select to authenticated using (public.is_admin());

create table if not exists public.nfe_entradas_proprias (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'rascunho' check (status in ('rascunho','no_bling','autorizada','cancelada','erro')),
  data_operacao date not null default current_date,
  fornecedor_nome text not null,
  fornecedor_bling_id text,
  fornecedor_documento text,
  fornecedor_ie text,
  fornecedor_email text,
  fornecedor_telefone text,
  fornecedor_endereco jsonb not null default '{}'::jsonb,
  itens jsonb not null default '[]'::jsonb,
  base_icms numeric(14,2) not null default 0 check (base_icms >= 0),
  aliquota_icms numeric(7,4) not null default 0 check (aliquota_icms >= 0),
  valor_icms numeric(14,2) not null default 0 check (valor_icms >= 0),
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  observacoes text,
  bling_nfe_id text,
  bling_nfe_numero text,
  bling_nfe_serie text,
  bling_nfe_chave_acesso text,
  bling_nfe_situacao text,
  bling_erro text,
  criado_por uuid references auth.users(id) on delete set null,
  atualizado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  autorizado_em timestamptz
);

create index if not exists nfe_entradas_proprias_data_idx
  on public.nfe_entradas_proprias(data_operacao desc, criado_em desc);

alter table public.nfe_entradas_proprias enable row level security;
drop policy if exists nfe_entradas_proprias_admin_select on public.nfe_entradas_proprias;
drop policy if exists nfe_entradas_proprias_admin_insert on public.nfe_entradas_proprias;
drop policy if exists nfe_entradas_proprias_admin_update on public.nfe_entradas_proprias;
create policy nfe_entradas_proprias_admin_select on public.nfe_entradas_proprias
  for select to authenticated using (public.is_admin());
create policy nfe_entradas_proprias_admin_insert on public.nfe_entradas_proprias
  for insert to authenticated with check (public.is_admin() and criado_por = auth.uid());
create policy nfe_entradas_proprias_admin_update on public.nfe_entradas_proprias
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

comment on table public.nfe_entradas_proprias is
  'Rascunhos e espelho das NF-e de entrada de emissao propria geradas no Bling.';

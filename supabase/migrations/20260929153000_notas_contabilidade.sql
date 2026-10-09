-- Central de documentos fiscais e contábeis. Mantém as compras de insumos
-- existentes e referencia seus anexos sem mover ou tornar arquivos públicos.

create table if not exists public.documentos_contabeis_tipos (
  codigo text primary key,
  nome text not null,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into public.documentos_contabeis_tipos(codigo,nome,ordem) values
  ('nota_fiscal','Nota Fiscal (NF-e)',10),
  ('xml_nfe','XML de NF-e',20),
  ('danfe','DANFE',30),
  ('nfse','NFS-e',40),
  ('comprovante_bancario','Comprovante bancário',50),
  ('comprovante_pix','Comprovante PIX',60),
  ('boleto','Boleto',70),
  ('recibo','Recibo',80),
  ('outro','Outro',90)
on conflict (codigo) do update set nome=excluded.nome, ordem=excluded.ordem;

create table if not exists public.documentos_contabeis (
  id uuid primary key default gen_random_uuid(),
  tipo_codigo text not null references public.documentos_contabeis_tipos(codigo),
  data_documento date not null,
  competencia date not null,
  descricao text,
  arquivo_path text not null,
  arquivo_nome text not null,
  arquivo_mime text not null,
  arquivo_bytes bigint not null check (arquivo_bytes > 0 and arquivo_bytes <= 15728640),
  arquivo_sha256 text,
  status text not null default 'arquivado',
  enviado_contabilidade_em timestamptz,
  compra_insumo_id uuid references public.compras_insumos(id) on delete set null,
  origem_tipo text,
  origem_id text,
  grupo_id uuid references public.documentos_contabeis(id) on delete set null,
  metadados jsonb not null default '{}'::jsonb,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (competencia = date_trunc('month', competencia)::date)
);

create unique index if not exists documentos_contabeis_compra_uidx
  on public.documentos_contabeis(compra_insumo_id)
  where compra_insumo_id is not null;
create index if not exists documentos_contabeis_competencia_idx
  on public.documentos_contabeis(competencia, data_documento desc, criado_em desc);
create index if not exists documentos_contabeis_status_idx
  on public.documentos_contabeis(status, competencia);
create index if not exists documentos_contabeis_sha_idx
  on public.documentos_contabeis(arquivo_sha256)
  where arquivo_sha256 is not null;

create table if not exists public.documentos_contabeis_config (
  id boolean primary key default true check (id),
  email_contador text,
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now()
);
insert into public.documentos_contabeis_config(id) values(true) on conflict (id) do nothing;

create table if not exists public.documentos_contabeis_envios (
  id uuid primary key default gen_random_uuid(),
  competencia date not null,
  destinatario text not null,
  quantidade_documentos integer not null check (quantidade_documentos >= 0),
  documento_ids uuid[] not null default '{}',
  status text not null,
  resend_id text,
  erro text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  check (competencia = date_trunc('month', competencia)::date)
);
create index if not exists documentos_contabeis_envios_comp_idx
  on public.documentos_contabeis_envios(competencia, criado_em desc);

alter table public.documentos_contabeis_tipos enable row level security;
alter table public.documentos_contabeis enable row level security;
alter table public.documentos_contabeis_config enable row level security;
alter table public.documentos_contabeis_envios enable row level security;

drop policy if exists documentos_contabeis_tipos_admin on public.documentos_contabeis_tipos;
create policy documentos_contabeis_tipos_admin on public.documentos_contabeis_tipos
for select to authenticated using (public.is_admin());
drop policy if exists documentos_contabeis_admin on public.documentos_contabeis;
create policy documentos_contabeis_admin on public.documentos_contabeis
for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists documentos_contabeis_config_admin on public.documentos_contabeis_config;
create policy documentos_contabeis_config_admin on public.documentos_contabeis_config
for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists documentos_contabeis_envios_admin on public.documentos_contabeis_envios;
create policy documentos_contabeis_envios_admin on public.documentos_contabeis_envios
for select to authenticated using (public.is_admin());

-- Espelha anexos antigos e futuros de compras de insumos na central genérica.
create or replace function public.espelhar_documento_compra_insumo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(new.arquivo_path,'') is null then return new; end if;
  insert into public.documentos_contabeis(
    tipo_codigo,data_documento,competencia,descricao,arquivo_path,arquivo_nome,
    arquivo_mime,arquivo_bytes,status,compra_insumo_id,origem_tipo,origem_id,criado_por,criado_em
  ) values (
    case when coalesce(new.arquivo_mime,'') in ('application/xml','text/xml') then 'xml_nfe' else 'nota_fiscal' end,
    new.data_emissao,date_trunc('month',new.data_emissao)::date,
    concat_ws(' · ',new.fornecedor,nullif(new.numero_documento,'')),new.arquivo_path,
    coalesce(nullif(new.arquivo_nome,''),'documento'),coalesce(nullif(new.arquivo_mime,''),'application/octet-stream'),
    greatest(coalesce(new.arquivo_bytes,1),1),'arquivado',new.id,'compra_insumo',new.id::text,
    new.criado_por,new.criado_em
  ) on conflict do nothing;
  update public.documentos_contabeis set
    data_documento=new.data_emissao,
    competencia=date_trunc('month',new.data_emissao)::date,
    descricao=concat_ws(' · ',new.fornecedor,nullif(new.numero_documento,'')),
    arquivo_path=new.arquivo_path,
    arquivo_nome=coalesce(nullif(new.arquivo_nome,''),'documento'),
    arquivo_mime=coalesce(nullif(new.arquivo_mime,''),'application/octet-stream'),
    arquivo_bytes=greatest(coalesce(new.arquivo_bytes,1),1),
    atualizado_em=now()
  where compra_insumo_id=new.id;
  return new;
end;
$$;

drop trigger if exists compras_insumos_espelhar_documento on public.compras_insumos;
create trigger compras_insumos_espelhar_documento
after insert or update of arquivo_path,arquivo_nome,arquivo_mime,arquivo_bytes,data_emissao,fornecedor,numero_documento
on public.compras_insumos for each row execute function public.espelhar_documento_compra_insumo();

insert into public.documentos_contabeis(
  tipo_codigo,data_documento,competencia,descricao,arquivo_path,arquivo_nome,
  arquivo_mime,arquivo_bytes,status,compra_insumo_id,origem_tipo,origem_id,criado_por,criado_em
)
select case when coalesce(c.arquivo_mime,'') in ('application/xml','text/xml') then 'xml_nfe' else 'nota_fiscal' end,
  c.data_emissao,date_trunc('month',c.data_emissao)::date,
  concat_ws(' · ',c.fornecedor,nullif(c.numero_documento,'')),c.arquivo_path,
  coalesce(nullif(c.arquivo_nome,''),'documento'),coalesce(nullif(c.arquivo_mime,''),'application/octet-stream'),
  greatest(coalesce(c.arquivo_bytes,1),1),'arquivado',c.id,'compra_insumo',c.id::text,c.criado_por,c.criado_em
from public.compras_insumos c
where nullif(c.arquivo_path,'') is not null
on conflict do nothing;

-- O bucket existente permanece privado e passa a servir à central completa.
update storage.buckets set
  public=false,
  file_size_limit=15728640,
  allowed_mime_types=array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp']
where id='notas-compra';

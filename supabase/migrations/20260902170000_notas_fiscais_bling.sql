-- Estado local da NF-e emitida pelo Bling. O documento fiscal continua sendo
-- a fonte de verdade; estes campos servem para UX, auditoria e retomada segura.
alter table public.pedidos
  add column if not exists bling_nfe_id text,
  add column if not exists bling_nfe_status text,
  add column if not exists bling_nfe_numero text,
  add column if not exists bling_nfe_chave_acesso text,
  add column if not exists bling_nfe_natureza_chave text,
  add column if not exists bling_nfe_ultima_consulta_em timestamptz,
  add column if not exists bling_nfe_erro text;

create index if not exists pedidos_bling_nfe_id_idx
  on public.pedidos (bling_nfe_id)
  where bling_nfe_id is not null;

comment on column public.pedidos.bling_nfe_natureza_chave is
  'Chave funcional de uma das cinco naturezas autorizadas no fluxo do painel; o ID fiscal permanece apenas no backend.';

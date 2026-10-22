-- Preserva documentos cancelados/rejeitados ao reemitir a mesma movimentacao.
alter table public.consignacao_movimentos
  add column if not exists bling_nfe_ambiente text,
  add column if not exists bling_nfe_historico jsonb not null default '[]'::jsonb;

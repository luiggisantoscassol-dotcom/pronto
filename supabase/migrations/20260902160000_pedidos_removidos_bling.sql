alter table public.pedidos
  add column if not exists bling_removido_em timestamptz;

comment on column public.pedidos.bling_removido_em is
  'Data em que a conciliação confirmou que a venda foi removida do Bling. O pedido local é preservado para auditoria.';

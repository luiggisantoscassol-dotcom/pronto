alter table public.pedidos
  add column if not exists frete_detalhes jsonb;

comment on column public.pedidos.frete_detalhes is
  'Snapshot validado no backend da cotacao de frete escolhida no checkout.';

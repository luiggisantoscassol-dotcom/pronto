-- Distingue vendas de saidas gratuitas no PDV. O valor do pedido continua
-- sendo o valor fiscal dos produtos, mas brindes nao representam receita.
alter table public.pedidos
  add column if not exists tipo_operacao text not null default 'venda';

alter table public.pedidos
  drop constraint if exists pedidos_tipo_operacao_check;

alter table public.pedidos
  add constraint pedidos_tipo_operacao_check
  check (tipo_operacao in ('venda', 'brinde'));

comment on column public.pedidos.tipo_operacao is
  'venda = operacao onerosa; brinde = remessa gratuita com valor somente fiscal.';

create index if not exists pedidos_tipo_operacao_created_idx
  on public.pedidos (tipo_operacao, created_at desc);

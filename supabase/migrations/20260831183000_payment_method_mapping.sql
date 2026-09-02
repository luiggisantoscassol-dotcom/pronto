alter table public.pedidos
  add column if not exists pagamento_metodo text,
  add column if not exists pagamento_parcelas integer;

comment on column public.pedidos.pagamento_metodo is
  'Identificador retornado pelo provedor, por exemplo pix, visa, master, elo ou amex.';

comment on column public.pedidos.pagamento_parcelas is
  'Quantidade de parcelas informada pelo provedor de pagamento.';

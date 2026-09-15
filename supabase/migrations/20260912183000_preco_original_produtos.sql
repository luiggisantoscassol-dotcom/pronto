alter table public.produtos
  add column if not exists preco_original numeric(12,2)
    check (preco_original is null or preco_original > 0);

comment on column public.produtos.preco_original is
  'Preço comercial de referência exibido riscado; pedidos e documentos fiscais usam produtos.preco.';

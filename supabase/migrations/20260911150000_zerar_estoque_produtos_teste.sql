-- Complemento da limpeza do ambiente de teste.
-- Preserva o catálogo e os IDs do Bling, zerando somente o saldo local.
update public.produtos
   set estoque = 0;

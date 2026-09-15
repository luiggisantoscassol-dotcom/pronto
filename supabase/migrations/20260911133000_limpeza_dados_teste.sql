-- Limpeza única dos dados operacionais usados durante a implantação.
-- Preserva usuários, clientes, produtos, vínculos com o Bling e credenciais.
begin;

-- Expedição e modelos de caixas.
delete from public.embalagem_baixas;
delete from public.embalagem_movimentos;
delete from public.embalagens;

-- Consignação: itens dependem dos movimentos e movimentos das empresas.
delete from public.consignacao_itens;
delete from public.consignacao_movimentos;
delete from public.consignacao_empresas;

-- Envase: apaga o histórico e zera os saldos de insumos de teste.
delete from public.movimentos_insumos_envase;
delete from public.envases;
update public.insumos_envase
   set quantidade = 0,
       atualizado_em = now();

-- Pedidos do site. Produtos e clientes permanecem cadastrados.
delete from public.pedidos;

commit;

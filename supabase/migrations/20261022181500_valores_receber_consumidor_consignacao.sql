-- Inclui as vendas a consumidor final feitas dentro da consignacao no contas a receber.

create or replace function public.registrar_venda_consumidor_consignacao(p_empresa uuid,p_data date,p_itens jsonb,p_consumidor jsonb,p_observacoes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_mov uuid; v_acerto uuid; v_item jsonb; v_prod public.produtos%rowtype; v_aloc public.consignacao_alocacoes%rowtype; v_q integer; v_qtd integer:=0; v_total numeric:=0; v_custo numeric:=0;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if trim(coalesce(p_consumidor->>'nome',''))='' or length(regexp_replace(coalesce(p_consumidor->>'documento',''),'\D','','g'))<>11 then raise exception 'Informe nome e CPF validos do consumidor final'; end if;

  insert into public.consignacao_acertos(empresa_id,data_acerto,observacoes,criado_por)
  values(p_empresa,p_data,concat_ws(' · ',nullif(trim(coalesce(p_observacoes,'')),''),'Venda a consumidor final: ' || trim(p_consumidor->>'nome')),auth.uid())
  returning id into v_acerto;

  insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,acerto_id,bling_estoque_status,consumidor_nome,consumidor_documento,consumidor_email,consumidor_telefone,consumidor_endereco,criado_por)
  values(p_empresa,'venda_consumidor',p_data,p_observacoes,v_acerto,'nao_aplicavel',p_consumidor->>'nome',regexp_replace(p_consumidor->>'documento','\D','','g'),nullif(p_consumidor->>'email',''),nullif(regexp_replace(coalesce(p_consumidor->>'telefone',''),'\D','','g'),''),coalesce(p_consumidor->'endereco','{}'::jsonb),auth.uid()) returning id into v_mov;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_q:=greatest(0,coalesce((v_item->>'quantidade')::integer,0)); if v_q=0 then continue; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    select * into v_aloc from public.consignacao_alocacoes where empresa_id=p_empresa and produto_id=v_prod.id for update;
    if v_q>coalesce(v_aloc.quantidade_consumidor,0) then raise exception 'Saldo para consumidor final insuficiente de %',v_prod.nome; end if;
    insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario,quantidade_consumidor) values(v_mov,v_prod.id,v_prod.bling_id,v_prod.nome,v_q,v_aloc.preco_acordado,coalesce(v_prod.custo,0),v_q);
    update public.consignacao_alocacoes set quantidade_consumidor=quantidade_consumidor-v_q,atualizado_em=now(),atualizado_por=auth.uid() where empresa_id=p_empresa and produto_id=v_prod.id;
    v_qtd:=v_qtd+v_q; v_total:=v_total+v_q*v_aloc.preco_acordado; v_custo:=v_custo+v_q*coalesce(v_prod.custo,0);
  end loop;
  if v_qtd=0 then raise exception 'Informe ao menos uma garrafa'; end if;
  update public.consignacao_movimentos set valor_total=v_total,custo_total=v_custo where id=v_mov;
  update public.consignacao_acertos set valor_vendido=v_total,custo_vendido=v_custo,quantidade_vendida=v_qtd,quantidade_devolvida=0,status_pagamento='pendente' where id=v_acerto;
  return v_mov;
end $$;

-- Recupera vendas a consumidor final anteriores a esta correcao para que aparecam no total.
do $$
declare v_mov record; v_acerto uuid; v_qtd integer;
begin
  for v_mov in
    select m.* from public.consignacao_movimentos m
    where m.tipo='venda_consumidor' and m.status='ativo' and m.acerto_id is null
  loop
    select coalesce(sum(i.quantidade),0)::integer into v_qtd from public.consignacao_itens i where i.movimento_id=v_mov.id;
    insert into public.consignacao_acertos(empresa_id,data_acerto,observacoes,criado_por,valor_vendido,custo_vendido,quantidade_vendida,quantidade_devolvida,status_pagamento)
    values(v_mov.empresa_id,v_mov.data_movimento,concat_ws(' · ',nullif(trim(coalesce(v_mov.observacoes,'')),''),'Venda a consumidor final: ' || coalesce(v_mov.consumidor_nome,'Consumidor')),v_mov.criado_por,coalesce(v_mov.valor_total,0),coalesce(v_mov.custo_total,0),v_qtd,0,case when coalesce(v_mov.valor_total,0)>0 then 'pendente' else 'sem_venda' end)
    returning id into v_acerto;
    update public.consignacao_movimentos set acerto_id=v_acerto where id=v_mov.id;
  end loop;
end $$;

revoke all on function public.registrar_venda_consumidor_consignacao(uuid,date,jsonb,jsonb,text) from public,anon;
grant execute on function public.registrar_venda_consumidor_consignacao(uuid,date,jsonb,jsonb,text) to authenticated;

-- Guarda a divisao da remessa para que qualquer estorno recomponha os dois canais.
alter table public.consignacao_itens
  add column if not exists quantidade_mercado integer not null default 0 check (quantidade_mercado >= 0),
  add column if not exists quantidade_consumidor integer not null default 0 check (quantidade_consumidor >= 0);

create or replace function public.registrar_remessa_consignacao_dividida(p_empresa uuid,p_data date,p_itens jsonb,p_deposito_bling_id text,p_observacoes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_mov uuid; v_item jsonb; v_prod public.produtos%rowtype; v_m integer; v_c integer; v_q integer; v_preco numeric;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,deposito_bling_id,bling_estoque_status,criado_por)
  values(p_empresa,'remessa',p_data,nullif(trim(coalesce(p_observacoes,'')),''),p_deposito_bling_id,'pendente',auth.uid()) returning id into v_mov;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_m:=greatest(0,coalesce((v_item->>'quantidade_mercado')::integer,0)); v_c:=greatest(0,coalesce((v_item->>'quantidade_consumidor')::integer,0)); v_q:=v_m+v_c;
    if v_q=0 then continue; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    if coalesce(v_prod.estoque,0)<v_q then raise exception 'Estoque insuficiente de %',v_prod.nome; end if;
    v_preco:=greatest(0,coalesce((v_item->>'preco_acordado')::numeric,v_prod.preco,0));
    update public.produtos set estoque=estoque-v_q where id=v_prod.id;
    insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario,quantidade_mercado,quantidade_consumidor) values(v_mov,v_prod.id,v_prod.bling_id,v_prod.nome,v_q,v_preco,coalesce(v_prod.custo,0),v_m,v_c);
    insert into public.consignacao_alocacoes values(p_empresa,v_prod.id,v_prod.bling_id,v_prod.nome,v_m,v_c,v_preco,auth.uid(),now())
    on conflict (empresa_id,produto_id) do update set quantidade_mercado=consignacao_alocacoes.quantidade_mercado+excluded.quantidade_mercado,quantidade_consumidor=consignacao_alocacoes.quantidade_consumidor+excluded.quantidade_consumidor,preco_acordado=excluded.preco_acordado,atualizado_por=auth.uid(),atualizado_em=now();
  end loop;
  if not exists(select 1 from public.consignacao_itens where movimento_id=v_mov) then raise exception 'Informe ao menos uma garrafa'; end if;
  return v_mov;
end $$;

create or replace function public.estornar_movimento_consignacao(p_movimento uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_mov public.consignacao_movimentos%rowtype; v_item record; v_vendido integer; v_devolvido integer; v_valor numeric; v_custo numeric;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  select * into v_mov from public.consignacao_movimentos where id=p_movimento for update;
  if not found or v_mov.status='estornado' then raise exception 'Movimento nao encontrado ou ja estornado'; end if;
  if v_mov.bling_nfe_id is not null and coalesce(v_mov.bling_nfe_status,'') not in ('2','4') then raise exception 'Cancele a NF-e no Bling antes do estorno'; end if;
  if trim(coalesce(p_motivo,''))='' then raise exception 'Informe o motivo do estorno'; end if;
  for v_item in select * from public.consignacao_itens where movimento_id=p_movimento loop
    if v_mov.tipo='remessa' then
      update public.produtos set estoque=estoque+v_item.quantidade where id=v_item.produto_id;
      update public.consignacao_alocacoes set quantidade_mercado=quantidade_mercado-v_item.quantidade_mercado,quantidade_consumidor=quantidade_consumidor-v_item.quantidade_consumidor,atualizado_em=now() where empresa_id=v_mov.empresa_id and produto_id=v_item.produto_id and quantidade_mercado>=v_item.quantidade_mercado and quantidade_consumidor>=v_item.quantidade_consumidor;
      if not found then raise exception 'A divisao atual nao permite estornar esta remessa de %',v_item.produto_nome; end if;
    elsif v_mov.tipo='venda' then
      update public.consignacao_alocacoes set quantidade_mercado=quantidade_mercado+v_item.quantidade,atualizado_em=now() where empresa_id=v_mov.empresa_id and produto_id=v_item.produto_id;
    elsif v_mov.tipo='venda_consumidor' then
      update public.consignacao_alocacoes set quantidade_consumidor=quantidade_consumidor+v_item.quantidade,atualizado_em=now() where empresa_id=v_mov.empresa_id and produto_id=v_item.produto_id;
    elsif v_mov.tipo='devolucao' then
      if (select estoque from public.produtos where id=v_item.produto_id for update)<v_item.quantidade then raise exception 'Estoque insuficiente para estornar a devolucao de %',v_item.produto_nome; end if;
      update public.produtos set estoque=estoque-v_item.quantidade where id=v_item.produto_id;
      update public.consignacao_alocacoes set quantidade_mercado=quantidade_mercado+v_item.quantidade,atualizado_em=now() where empresa_id=v_mov.empresa_id and produto_id=v_item.produto_id;
    end if;
  end loop;
  update public.consignacao_movimentos set status='estornado',estornado_em=now(),estornado_por=auth.uid(),motivo_estorno=trim(p_motivo) where id=p_movimento;
  if v_mov.acerto_id is not null then
    select coalesce(sum(case when m.tipo='venda' then coalesce(q.quantidade,0) else 0 end),0)::integer,coalesce(sum(case when m.tipo='devolucao' then coalesce(q.quantidade,0) else 0 end),0)::integer,coalesce(sum(case when m.tipo='venda' then m.valor_total else 0 end),0),coalesce(sum(case when m.tipo='venda' then m.custo_total else 0 end),0)
    into v_vendido,v_devolvido,v_valor,v_custo from public.consignacao_movimentos m left join (select movimento_id,sum(quantidade)::integer quantidade from public.consignacao_itens group by movimento_id) q on q.movimento_id=m.id where m.acerto_id=v_mov.acerto_id and m.status='ativo';
    update public.consignacao_acertos set quantidade_vendida=v_vendido,quantidade_devolvida=v_devolvido,valor_vendido=v_valor,custo_vendido=v_custo,status_pagamento=case when v_vendido=0 and v_devolvido=0 then 'estornado' when v_vendido=0 then 'sem_venda' else 'pendente' end where id=v_mov.acerto_id;
  end if;
  return jsonb_build_object('tipo',v_mov.tipo,'deposito_bling_id',v_mov.deposito_bling_id,'bling_estoque_sincronizado',v_mov.bling_estoque_status='sincronizado');
end $$;

grant execute on function public.registrar_remessa_consignacao_dividida(uuid,date,jsonb,text,text) to authenticated;
grant execute on function public.estornar_movimento_consignacao(uuid,text) to authenticated;

-- Acerto atomico de consignacao, com historico financeiro e custo da venda.

alter table public.consignacao_itens
  add column if not exists custo_unitario numeric(12,2) not null default 0
  check (custo_unitario >= 0);

alter table public.consignacao_movimentos
  add column if not exists acerto_id uuid,
  add column if not exists valor_total numeric(12,2) not null default 0,
  add column if not exists custo_total numeric(12,2) not null default 0,
  add column if not exists bling_nfe_data_emissao timestamptz;

create table if not exists public.consignacao_acertos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.consignacao_empresas(id),
  data_acerto date not null,
  valor_vendido numeric(12,2) not null default 0 check (valor_vendido >= 0),
  custo_vendido numeric(12,2) not null default 0 check (custo_vendido >= 0),
  quantidade_vendida integer not null default 0 check (quantidade_vendida >= 0),
  quantidade_devolvida integer not null default 0 check (quantidade_devolvida >= 0),
  status_pagamento text not null default 'pendente' check (status_pagamento in ('pendente','recebido','sem_venda','estornado')),
  recebido_em timestamptz,
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

alter table public.consignacao_movimentos
  drop constraint if exists consignacao_movimentos_acerto_id_fkey;
alter table public.consignacao_movimentos
  add constraint consignacao_movimentos_acerto_id_fkey
  foreign key (acerto_id) references public.consignacao_acertos(id) on delete restrict;

create index if not exists consignacao_acertos_empresa_data_idx
  on public.consignacao_acertos(empresa_id,data_acerto desc);
create index if not exists consignacao_movimentos_acerto_idx
  on public.consignacao_movimentos(acerto_id);

alter table public.consignacao_acertos enable row level security;
drop policy if exists "admin acertos consignacao" on public.consignacao_acertos;
create policy "admin acertos consignacao" on public.consignacao_acertos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.consignacao_acertos to authenticated;

-- Preserva o custo e o valor das vendas antigas para o painel de Resultados.
update public.consignacao_itens i
set custo_unitario=greatest(0,coalesce(p.custo,0))
from public.produtos p
where p.id=i.produto_id and i.custo_unitario=0;

update public.consignacao_movimentos m
set valor_total=coalesce(t.valor,0),custo_total=coalesce(t.custo,0)
from (
  select movimento_id,
         sum(quantidade*valor_unitario)::numeric(12,2) valor,
         sum(quantidade*custo_unitario)::numeric(12,2) custo
  from public.consignacao_itens group by movimento_id
) t
where m.id=t.movimento_id and m.tipo='venda';

create or replace function public.registrar_acerto_consignacao(
  p_empresa uuid,
  p_data date,
  p_itens jsonb,
  p_deposito_bling_id text default null,
  p_observacoes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_acerto uuid;
  v_venda uuid;
  v_devolucao uuid;
  v_item jsonb;
  v_prod public.produtos%rowtype;
  v_vendidas integer;
  v_devolvidas integer;
  v_saldo integer;
  v_valor numeric(12,2);
  v_custo numeric(12,2);
  v_total numeric(12,2) := 0;
  v_custo_total numeric(12,2) := 0;
  v_qtd_vendida integer := 0;
  v_qtd_devolvida integer := 0;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if p_data is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)=0 then
    raise exception 'Data e produtos sao obrigatorios';
  end if;
  if not exists(select 1 from public.consignacao_empresas where id=p_empresa and ativa) then
    raise exception 'Empresa nao encontrada ou inativa';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_vendidas := greatest(0,coalesce((v_item->>'vendidas')::integer,0));
    v_devolvidas := greatest(0,coalesce((v_item->>'devolvidas')::integer,0));
    if v_vendidas+v_devolvidas=0 then continue; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    if not found or coalesce(v_prod.bling_id,'')='' then raise exception 'Produto invalido ou sem vinculo com o Bling'; end if;
    select coalesce(sum(case m.tipo when 'remessa' then i.quantidade else -i.quantidade end),0)::integer into v_saldo
    from public.consignacao_movimentos m join public.consignacao_itens i on i.movimento_id=m.id
    where m.empresa_id=p_empresa and i.produto_id=v_prod.id and m.status='ativo';
    if v_vendidas+v_devolvidas>v_saldo then
      raise exception 'O acerto de % ultrapassa o saldo consignado de % unidade(s)',v_prod.nome,v_saldo;
    end if;
  end loop;

  insert into public.consignacao_acertos(empresa_id,data_acerto,observacoes,criado_por)
  values(p_empresa,p_data,nullif(trim(coalesce(p_observacoes,'')),''),auth.uid()) returning id into v_acerto;

  if exists(select 1 from jsonb_array_elements(p_itens) x where greatest(0,coalesce((x->>'vendidas')::integer,0))>0) then
    insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,acerto_id,bling_estoque_status,criado_por)
    values(p_empresa,'venda',p_data,nullif(trim(coalesce(p_observacoes,'')),''),v_acerto,'nao_aplicavel',auth.uid()) returning id into v_venda;
  end if;
  if exists(select 1 from jsonb_array_elements(p_itens) x where greatest(0,coalesce((x->>'devolvidas')::integer,0))>0) then
    if trim(coalesce(p_deposito_bling_id,''))='' then raise exception 'Selecione o deposito do Bling para a devolucao'; end if;
    insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,acerto_id,deposito_bling_id,bling_estoque_status,criado_por)
    values(p_empresa,'devolucao',p_data,nullif(trim(coalesce(p_observacoes,'')),''),v_acerto,trim(p_deposito_bling_id),'pendente',auth.uid()) returning id into v_devolucao;
  end if;

  if v_venda is null and v_devolucao is null then raise exception 'Informe ao menos uma venda ou devolucao'; end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_vendidas := greatest(0,coalesce((v_item->>'vendidas')::integer,0));
    v_devolvidas := greatest(0,coalesce((v_item->>'devolvidas')::integer,0));
    if v_vendidas+v_devolvidas=0 then continue; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    v_valor := greatest(0,coalesce(nullif(v_item->>'valor_unitario','')::numeric,v_prod.preco,0));
    v_custo := greatest(0,coalesce(v_prod.custo,0));
    if v_vendidas>0 then
      insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario)
      values(v_venda,v_prod.id,v_prod.bling_id,v_prod.nome,v_vendidas,v_valor,v_custo);
      v_total := v_total+(v_vendidas*v_valor);
      v_custo_total := v_custo_total+(v_vendidas*v_custo);
      v_qtd_vendida := v_qtd_vendida+v_vendidas;
    end if;
    if v_devolvidas>0 then
      insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario)
      values(v_devolucao,v_prod.id,v_prod.bling_id,v_prod.nome,v_devolvidas,v_valor,v_custo);
      update public.produtos set estoque=estoque+v_devolvidas where id=v_prod.id;
      v_qtd_devolvida := v_qtd_devolvida+v_devolvidas;
    end if;
  end loop;

  if v_venda is not null then update public.consignacao_movimentos set valor_total=v_total,custo_total=v_custo_total where id=v_venda; end if;
  update public.consignacao_acertos set
    valor_vendido=v_total,custo_vendido=v_custo_total,
    quantidade_vendida=v_qtd_vendida,quantidade_devolvida=v_qtd_devolvida,
    status_pagamento=case when v_qtd_vendida>0 then 'pendente' else 'sem_venda' end
  where id=v_acerto;

  return jsonb_build_object('acerto_id',v_acerto,'venda_id',v_venda,'devolucao_id',v_devolucao,'valor_vendido',v_total,'quantidade_vendida',v_qtd_vendida,'quantidade_devolvida',v_qtd_devolvida);
end $$;

create or replace function public.marcar_acerto_consignacao_recebido(p_acerto uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  update public.consignacao_acertos
  set status_pagamento='recebido',recebido_em=now()
  where id=p_acerto and status_pagamento='pendente';
  if not found then raise exception 'Acerto pendente nao encontrado'; end if;
end $$;

create or replace function public.estornar_movimento_consignacao(p_movimento uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_mov public.consignacao_movimentos%rowtype;
  v_item record;
  v_vendido integer;
  v_devolvido integer;
  v_valor numeric(12,2);
  v_custo numeric(12,2);
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  select * into v_mov from public.consignacao_movimentos where id=p_movimento for update;
  if not found or v_mov.status='estornado' then raise exception 'Movimento nao encontrado ou ja estornado'; end if;
  if v_mov.bling_nfe_id is not null and coalesce(v_mov.bling_nfe_status,'') not in ('2','4') then
    raise exception 'Esta movimentacao possui NF-e ativa. Cancele o documento no Bling e confirme o cancelamento no painel antes do estorno';
  end if;
  if trim(coalesce(p_motivo,''))='' then raise exception 'Informe o motivo do estorno'; end if;
  for v_item in select * from public.consignacao_itens where movimento_id=p_movimento loop
    if v_mov.tipo='remessa' then
      update public.produtos set estoque=estoque+v_item.quantidade where id=v_item.produto_id;
    elsif v_mov.tipo='devolucao' then
      if (select estoque from public.produtos where id=v_item.produto_id for update)<v_item.quantidade then
        raise exception 'Estoque insuficiente para estornar a devolucao de %',v_item.produto_nome;
      end if;
      update public.produtos set estoque=estoque-v_item.quantidade where id=v_item.produto_id;
    end if;
  end loop;
  update public.consignacao_movimentos set status='estornado',estornado_em=now(),estornado_por=auth.uid(),motivo_estorno=trim(p_motivo) where id=p_movimento;

  if v_mov.acerto_id is not null then
    select
      coalesce(sum(case when m.tipo='venda' then coalesce(q.quantidade,0) else 0 end),0)::integer,
      coalesce(sum(case when m.tipo='devolucao' then coalesce(q.quantidade,0) else 0 end),0)::integer,
      coalesce(sum(case when m.tipo='venda' then m.valor_total else 0 end),0),
      coalesce(sum(case when m.tipo='venda' then m.custo_total else 0 end),0)
    into v_vendido,v_devolvido,v_valor,v_custo
    from public.consignacao_movimentos m
    left join (
      select movimento_id,sum(quantidade)::integer quantidade
      from public.consignacao_itens group by movimento_id
    ) q on q.movimento_id=m.id
    where m.acerto_id=v_mov.acerto_id and m.status='ativo';
    update public.consignacao_acertos set
      quantidade_vendida=v_vendido,quantidade_devolvida=v_devolvido,
      valor_vendido=v_valor,custo_vendido=v_custo,
      status_pagamento=case when v_vendido=0 and v_devolvido=0 then 'estornado' when v_vendido=0 then 'sem_venda' when status_pagamento='recebido' then 'recebido' else 'pendente' end
    where id=v_mov.acerto_id;
  end if;
  return jsonb_build_object('tipo',v_mov.tipo,'deposito_bling_id',v_mov.deposito_bling_id,'bling_estoque_sincronizado',v_mov.bling_estoque_status='sincronizado');
end $$;

revoke all on function public.registrar_acerto_consignacao(uuid,date,jsonb,text,text) from public,anon;
revoke all on function public.marcar_acerto_consignacao_recebido(uuid) from public,anon;
grant execute on function public.registrar_acerto_consignacao(uuid,date,jsonb,text,text) to authenticated;
grant execute on function public.marcar_acerto_consignacao_recebido(uuid) to authenticated;
grant execute on function public.estornar_movimento_consignacao(uuid,text) to authenticated;

-- Separa o estoque fisico deixado em cada mercado por canal de venda,
-- registra consumidor final real e permite pagamentos parciais dos acertos.

alter table public.consignacao_movimentos drop constraint if exists consignacao_movimentos_tipo_check;
alter table public.consignacao_movimentos add constraint consignacao_movimentos_tipo_check
  check (tipo in ('remessa','venda','venda_consumidor','devolucao'));

alter table public.consignacao_movimentos
  add column if not exists consumidor_nome text,
  add column if not exists consumidor_documento text,
  add column if not exists consumidor_email text,
  add column if not exists consumidor_telefone text,
  add column if not exists consumidor_endereco jsonb,
  add column if not exists consumidor_bling_contato_id text;

alter table public.consignacao_itens
  add column if not exists quantidade_mercado integer not null default 0 check (quantidade_mercado >= 0),
  add column if not exists quantidade_consumidor integer not null default 0 check (quantidade_consumidor >= 0);

create table if not exists public.consignacao_alocacoes (
  empresa_id uuid not null references public.consignacao_empresas(id),
  produto_id uuid not null references public.produtos(id),
  produto_bling_id text not null,
  produto_nome text not null,
  quantidade_mercado integer not null default 0 check (quantidade_mercado >= 0),
  quantidade_consumidor integer not null default 0 check (quantidade_consumidor >= 0),
  preco_acordado numeric(12,2) not null default 0 check (preco_acordado >= 0),
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id,produto_id)
);

alter table public.consignacao_alocacoes enable row level security;
drop policy if exists "admin alocacoes consignacao" on public.consignacao_alocacoes;
create policy "admin alocacoes consignacao" on public.consignacao_alocacoes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.consignacao_alocacoes to authenticated;

insert into public.consignacao_alocacoes(empresa_id,produto_id,produto_bling_id,produto_nome,quantidade_mercado,quantidade_consumidor,preco_acordado)
select s.empresa_id,s.produto_id,s.produto_bling_id,s.produto_nome,greatest(0,s.quantidade),0,coalesce(p.preco,0)
from public.consignacao_saldos s join public.produtos p on p.id=s.produto_id
on conflict (empresa_id,produto_id) do nothing;

alter table public.consignacao_acertos drop constraint if exists consignacao_acertos_status_pagamento_check;
alter table public.consignacao_acertos add constraint consignacao_acertos_status_pagamento_check
  check (status_pagamento in ('pendente','parcial','recebido','sem_venda','estornado'));

create table if not exists public.consignacao_pagamentos (
  id uuid primary key default gen_random_uuid(),
  acerto_id uuid not null references public.consignacao_acertos(id),
  valor numeric(12,2) not null check (valor > 0),
  data_pagamento date not null,
  forma_pagamento text,
  observacoes text,
  status text not null default 'ativo' check (status in ('ativo','estornado')),
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);
alter table public.consignacao_pagamentos enable row level security;
drop policy if exists "admin pagamentos consignacao" on public.consignacao_pagamentos;
create policy "admin pagamentos consignacao" on public.consignacao_pagamentos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.consignacao_pagamentos to authenticated;

create or replace function public.ajustar_alocacao_consignacao(p_empresa uuid,p_itens jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_item jsonb; v_prod public.produtos%rowtype; v_mercado integer; v_consumidor integer; v_fisico integer;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_mercado:=greatest(0,coalesce((v_item->>'quantidade_mercado')::integer,0));
    v_consumidor:=greatest(0,coalesce((v_item->>'quantidade_consumidor')::integer,0));
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid;
    select coalesce(quantidade,0) into v_fisico from public.consignacao_saldos where empresa_id=p_empresa and produto_id=v_prod.id;
    if v_mercado+v_consumidor<>coalesce(v_fisico,0) then raise exception 'A divisao de % precisa totalizar % garrafa(s)',v_prod.nome,coalesce(v_fisico,0); end if;
    insert into public.consignacao_alocacoes values(p_empresa,v_prod.id,v_prod.bling_id,v_prod.nome,v_mercado,v_consumidor,greatest(0,coalesce((v_item->>'preco_acordado')::numeric,v_prod.preco,0)),auth.uid(),now())
    on conflict (empresa_id,produto_id) do update set quantidade_mercado=excluded.quantidade_mercado,quantidade_consumidor=excluded.quantidade_consumidor,preco_acordado=excluded.preco_acordado,atualizado_por=auth.uid(),atualizado_em=now();
  end loop;
end $$;

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

create or replace function public.registrar_acerto_mercado_consignacao(p_empresa uuid,p_data date,p_itens jsonb,p_deposito_bling_id text default null,p_observacoes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_acerto uuid; v_venda uuid; v_dev uuid; v_item jsonb; v_prod public.produtos%rowtype; v_aloc public.consignacao_alocacoes%rowtype; v_v integer; v_d integer; v_total numeric:=0; v_custo numeric:=0; v_qv integer:=0; v_qd integer:=0;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  insert into public.consignacao_acertos(empresa_id,data_acerto,observacoes,criado_por) values(p_empresa,p_data,p_observacoes,auth.uid()) returning id into v_acerto;
  if exists(select 1 from jsonb_array_elements(p_itens) x where coalesce((x->>'vendidas')::integer,0)>0) then insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,acerto_id,bling_estoque_status,criado_por) values(p_empresa,'venda',p_data,p_observacoes,v_acerto,'nao_aplicavel',auth.uid()) returning id into v_venda; end if;
  if exists(select 1 from jsonb_array_elements(p_itens) x where coalesce((x->>'devolvidas')::integer,0)>0) then
    if trim(coalesce(p_deposito_bling_id,''))='' then raise exception 'Selecione o deposito para a devolucao'; end if;
    insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,acerto_id,deposito_bling_id,bling_estoque_status,criado_por) values(p_empresa,'devolucao',p_data,p_observacoes,v_acerto,p_deposito_bling_id,'pendente',auth.uid()) returning id into v_dev;
  end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_v:=greatest(0,coalesce((v_item->>'vendidas')::integer,0)); v_d:=greatest(0,coalesce((v_item->>'devolvidas')::integer,0)); if v_v+v_d=0 then continue; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    select * into v_aloc from public.consignacao_alocacoes where empresa_id=p_empresa and produto_id=v_prod.id for update;
    if v_v+v_d>coalesce(v_aloc.quantidade_mercado,0) then raise exception 'Saldo destinado ao mercado insuficiente de %',v_prod.nome; end if;
    if v_v>0 then insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario,quantidade_mercado) values(v_venda,v_prod.id,v_prod.bling_id,v_prod.nome,v_v,v_aloc.preco_acordado,coalesce(v_prod.custo,0),v_v); v_total:=v_total+v_v*v_aloc.preco_acordado; v_custo:=v_custo+v_v*coalesce(v_prod.custo,0); v_qv:=v_qv+v_v; end if;
    if v_d>0 then insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario,quantidade_mercado) values(v_dev,v_prod.id,v_prod.bling_id,v_prod.nome,v_d,v_aloc.preco_acordado,coalesce(v_prod.custo,0),v_d); update public.produtos set estoque=estoque+v_d where id=v_prod.id; v_qd:=v_qd+v_d; end if;
    update public.consignacao_alocacoes set quantidade_mercado=quantidade_mercado-v_v-v_d,atualizado_em=now(),atualizado_por=auth.uid() where empresa_id=p_empresa and produto_id=v_prod.id;
  end loop;
  if v_venda is null and v_dev is null then raise exception 'Informe ao menos uma venda ou devolucao'; end if;
  if v_venda is not null then update public.consignacao_movimentos set valor_total=v_total,custo_total=v_custo where id=v_venda; end if;
  update public.consignacao_acertos set valor_vendido=v_total,custo_vendido=v_custo,quantidade_vendida=v_qv,quantidade_devolvida=v_qd,status_pagamento=case when v_qv>0 then 'pendente' else 'sem_venda' end where id=v_acerto;
  return jsonb_build_object('acerto_id',v_acerto,'venda_id',v_venda,'devolucao_id',v_dev,'valor_vendido',v_total);
end $$;

create or replace function public.registrar_venda_consumidor_consignacao(p_empresa uuid,p_data date,p_itens jsonb,p_consumidor jsonb,p_observacoes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_mov uuid; v_item jsonb; v_prod public.produtos%rowtype; v_aloc public.consignacao_alocacoes%rowtype; v_q integer; v_total numeric:=0; v_custo numeric:=0;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if trim(coalesce(p_consumidor->>'nome',''))='' or length(regexp_replace(coalesce(p_consumidor->>'documento',''),'\D','','g'))<>11 then raise exception 'Informe nome e CPF validos do consumidor final'; end if;
  insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,bling_estoque_status,consumidor_nome,consumidor_documento,consumidor_email,consumidor_telefone,consumidor_endereco,criado_por)
  values(p_empresa,'venda_consumidor',p_data,p_observacoes,'nao_aplicavel',p_consumidor->>'nome',regexp_replace(p_consumidor->>'documento','\D','','g'),nullif(p_consumidor->>'email',''),nullif(regexp_replace(coalesce(p_consumidor->>'telefone',''),'\D','','g'),''),coalesce(p_consumidor->'endereco','{}'::jsonb),auth.uid()) returning id into v_mov;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_q:=greatest(0,coalesce((v_item->>'quantidade')::integer,0)); if v_q=0 then continue; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    select * into v_aloc from public.consignacao_alocacoes where empresa_id=p_empresa and produto_id=v_prod.id for update;
    if v_q>coalesce(v_aloc.quantidade_consumidor,0) then raise exception 'Saldo para consumidor final insuficiente de %',v_prod.nome; end if;
    insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario,custo_unitario,quantidade_consumidor) values(v_mov,v_prod.id,v_prod.bling_id,v_prod.nome,v_q,v_aloc.preco_acordado,coalesce(v_prod.custo,0),v_q);
    update public.consignacao_alocacoes set quantidade_consumidor=quantidade_consumidor-v_q,atualizado_em=now(),atualizado_por=auth.uid() where empresa_id=p_empresa and produto_id=v_prod.id;
    v_total:=v_total+v_q*v_aloc.preco_acordado; v_custo:=v_custo+v_q*coalesce(v_prod.custo,0);
  end loop;
  if not exists(select 1 from public.consignacao_itens where movimento_id=v_mov) then raise exception 'Informe ao menos uma garrafa'; end if;
  update public.consignacao_movimentos set valor_total=v_total,custo_total=v_custo where id=v_mov;
  return v_mov;
end $$;

create or replace function public.registrar_pagamento_consignacao(p_acerto uuid,p_valor numeric,p_data date,p_forma text default null,p_observacoes text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_total numeric; v_pago numeric;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  select valor_vendido into v_total from public.consignacao_acertos where id=p_acerto and status_pagamento not in ('sem_venda','estornado') for update;
  select coalesce(sum(valor),0) into v_pago from public.consignacao_pagamentos where acerto_id=p_acerto and status='ativo';
  if p_valor<=0 or v_pago+p_valor>v_total+0.009 then raise exception 'Valor invalido. Restam R$ %',v_total-v_pago; end if;
  insert into public.consignacao_pagamentos(acerto_id,valor,data_pagamento,forma_pagamento,observacoes,criado_por) values(p_acerto,p_valor,p_data,p_forma,p_observacoes,auth.uid());
  update public.consignacao_acertos set status_pagamento=case when v_pago+p_valor>=v_total-0.009 then 'recebido' else 'parcial' end,recebido_em=case when v_pago+p_valor>=v_total-0.009 then now() else null end where id=p_acerto;
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

revoke all on function public.ajustar_alocacao_consignacao(uuid,jsonb) from public,anon;
revoke all on function public.registrar_remessa_consignacao_dividida(uuid,date,jsonb,text,text) from public,anon;
revoke all on function public.registrar_acerto_mercado_consignacao(uuid,date,jsonb,text,text) from public,anon;
revoke all on function public.registrar_venda_consumidor_consignacao(uuid,date,jsonb,jsonb,text) from public,anon;
revoke all on function public.registrar_pagamento_consignacao(uuid,numeric,date,text,text) from public,anon;
grant execute on function public.ajustar_alocacao_consignacao(uuid,jsonb) to authenticated;
grant execute on function public.registrar_remessa_consignacao_dividida(uuid,date,jsonb,text,text) to authenticated;
grant execute on function public.registrar_acerto_mercado_consignacao(uuid,date,jsonb,text,text) to authenticated;
grant execute on function public.registrar_venda_consumidor_consignacao(uuid,date,jsonb,jsonb,text) to authenticated;
grant execute on function public.registrar_pagamento_consignacao(uuid,numeric,date,text,text) to authenticated;
grant execute on function public.estornar_movimento_consignacao(uuid,text) to authenticated;

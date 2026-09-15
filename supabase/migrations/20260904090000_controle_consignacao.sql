-- Controle administrativo de estoque em consignação por empresa.
create table if not exists public.consignacao_empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_fantasia text,
  documento text,
  inscricao_estadual text,
  email text,
  telefone text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  bling_contato_id text,
  ativa boolean not null default true,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.consignacao_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.consignacao_empresas(id),
  tipo text not null check (tipo in ('remessa','venda','devolucao')),
  data_movimento date not null,
  observacoes text,
  movimento_origem_id uuid references public.consignacao_movimentos(id),
  status text not null default 'ativo' check (status in ('ativo','estornado')),
  deposito_bling_id text,
  bling_estoque_status text not null default 'pendente' check (bling_estoque_status in ('pendente','sincronizado','nao_aplicavel','erro')),
  bling_estoque_erro text,
  bling_pedido_id text,
  bling_nfe_id text,
  bling_nfe_numero text,
  bling_nfe_status text,
  bling_nfe_chave_acesso text,
  bling_nfe_erro text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  estornado_em timestamptz,
  estornado_por uuid references auth.users(id),
  motivo_estorno text
);

create table if not exists public.consignacao_itens (
  id bigint generated always as identity primary key,
  movimento_id uuid not null references public.consignacao_movimentos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  produto_bling_id text not null,
  produto_nome text not null,
  quantidade integer not null check (quantidade > 0),
  valor_unitario numeric(12,2) not null default 0 check (valor_unitario >= 0)
);

create index if not exists consignacao_movimentos_empresa_data_idx on public.consignacao_movimentos(empresa_id,data_movimento desc);
create index if not exists consignacao_itens_movimento_idx on public.consignacao_itens(movimento_id);

alter table public.consignacao_empresas enable row level security;
alter table public.consignacao_movimentos enable row level security;
alter table public.consignacao_itens enable row level security;

create policy "admin empresas consignacao" on public.consignacao_empresas for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin movimentos consignacao" on public.consignacao_movimentos for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin itens consignacao" on public.consignacao_itens for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace view public.consignacao_saldos with (security_invoker=true) as
select m.empresa_id, i.produto_id, max(i.produto_bling_id) produto_bling_id,
       max(i.produto_nome) produto_nome,
       sum(case m.tipo when 'remessa' then i.quantidade else -i.quantidade end)::integer quantidade
from public.consignacao_movimentos m
join public.consignacao_itens i on i.movimento_id=m.id
where m.status='ativo'
group by m.empresa_id,i.produto_id
having sum(case m.tipo when 'remessa' then i.quantidade else -i.quantidade end) <> 0;

grant select on public.consignacao_saldos to authenticated;

create or replace function public.registrar_movimento_consignacao(
  p_empresa uuid, p_tipo text, p_data date, p_itens jsonb,
  p_deposito_bling_id text default null, p_observacoes text default null,
  p_movimento_origem uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_mov uuid; v_item jsonb; v_prod public.produtos%rowtype; v_qtd integer; v_saldo integer;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if p_tipo not in ('remessa','venda','devolucao') then raise exception 'Tipo de movimento inválido'; end if;
  if p_data is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)=0 then raise exception 'Data e produtos são obrigatórios'; end if;
  if not exists(select 1 from public.consignacao_empresas where id=p_empresa and ativa) then raise exception 'Empresa não encontrada ou inativa'; end if;
  insert into public.consignacao_movimentos(empresa_id,tipo,data_movimento,observacoes,movimento_origem_id,deposito_bling_id,bling_estoque_status,criado_por)
  values(p_empresa,p_tipo,p_data,nullif(trim(coalesce(p_observacoes,'')),''),p_movimento_origem,nullif(trim(coalesce(p_deposito_bling_id,'')),''),case when p_tipo='venda' then 'nao_aplicavel' else 'pendente' end,auth.uid()) returning id into v_mov;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item->>'quantidade')::integer;
    if v_qtd <= 0 then raise exception 'Quantidade inválida'; end if;
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid for update;
    if not found or coalesce(v_prod.bling_id,'')='' then raise exception 'Produto inválido ou sem vínculo com o Bling'; end if;
    if p_tipo='remessa' then
      if coalesce(v_prod.estoque,0)<v_qtd then raise exception 'Estoque insuficiente de %',v_prod.nome; end if;
      update public.produtos set estoque=estoque-v_qtd where id=v_prod.id;
    else
      select coalesce(sum(case m.tipo when 'remessa' then i.quantidade else -i.quantidade end),0)::integer into v_saldo
      from public.consignacao_movimentos m join public.consignacao_itens i on i.movimento_id=m.id
      where m.empresa_id=p_empresa and i.produto_id=v_prod.id and m.status='ativo';
      if v_saldo<v_qtd then raise exception 'Saldo consignado insuficiente de %',v_prod.nome; end if;
      if p_tipo='devolucao' then update public.produtos set estoque=estoque+v_qtd where id=v_prod.id; end if;
    end if;
    insert into public.consignacao_itens(movimento_id,produto_id,produto_bling_id,produto_nome,quantidade,valor_unitario)
    values(v_mov,v_prod.id,v_prod.bling_id,v_prod.nome,v_qtd,coalesce(v_prod.preco,0));
  end loop;
  return v_mov;
end $$;

create or replace function public.estornar_movimento_consignacao(p_movimento uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_mov public.consignacao_movimentos%rowtype; v_item record;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  select * into v_mov from public.consignacao_movimentos where id=p_movimento for update;
  if not found or v_mov.status='estornado' then raise exception 'Movimento não encontrado ou já estornado'; end if;
  if v_mov.bling_nfe_id is not null then raise exception 'Esta movimentação possui NF-e. Cancele ou regularize o documento fiscal antes do estorno'; end if;
  if trim(coalesce(p_motivo,''))='' then raise exception 'Informe o motivo do estorno'; end if;
  for v_item in select * from public.consignacao_itens where movimento_id=p_movimento loop
    if v_mov.tipo='remessa' then update public.produtos set estoque=estoque+v_item.quantidade where id=v_item.produto_id;
    elsif v_mov.tipo='devolucao' then
      if (select estoque from public.produtos where id=v_item.produto_id for update)<v_item.quantidade then raise exception 'Estoque insuficiente para estornar a devolução de %',v_item.produto_nome; end if;
      update public.produtos set estoque=estoque-v_item.quantidade where id=v_item.produto_id;
    end if;
  end loop;
  update public.consignacao_movimentos set status='estornado',estornado_em=now(),estornado_por=auth.uid(),motivo_estorno=trim(p_motivo) where id=p_movimento;
  return jsonb_build_object('tipo',v_mov.tipo,'deposito_bling_id',v_mov.deposito_bling_id,'bling_estoque_sincronizado',v_mov.bling_estoque_status='sincronizado');
end $$;

grant execute on function public.registrar_movimento_consignacao(uuid,text,date,jsonb,text,text,uuid) to authenticated;
grant execute on function public.estornar_movimento_consignacao(uuid,text) to authenticated;

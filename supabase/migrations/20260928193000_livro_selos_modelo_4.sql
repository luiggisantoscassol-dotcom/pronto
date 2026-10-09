-- Livro de Registro de Entrada e Saida do Selo de Controle (Modelo 4).
-- O saldo fisico continua em insumos_envase. O livro mantem tambem um saldo
-- fiscal, evitando descontar duas vezes o mesmo selo: aplicacao no envase e
-- saida vinculada a NF-e sao eventos distintos.

create table if not exists public.livro_selos_movimentos (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos_envase(id) on delete restrict,
  data_movimento date not null default current_date,
  tipo text not null check (tipo in (
    'saldo_inicial','entrada','aplicacao_envase','inutilizacao','devolucao',
    'saida_fiscal','estorno_saida_fiscal','ajuste_positivo','ajuste_negativo','estorno_envase'
  )),
  quantidade integer not null check (quantidade > 0),
  impacto_saldo_fiscal integer not null,
  guia_numero text,
  guia_data date,
  numeracao_inicial bigint,
  numeracao_final bigint,
  grupo text,
  subgrupo text,
  cor text,
  serie text,
  nfe_numero text,
  nfe_serie text,
  pedido_id uuid references public.pedidos(id) on delete set null,
  envase_id uuid references public.envases(id) on delete set null,
  origem_tipo text not null default 'manual',
  origem_id text,
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_por_email text,
  criado_em timestamptz not null default now(),
  check (numeracao_final is null or numeracao_inicial is null or numeracao_final >= numeracao_inicial)
);

create unique index if not exists livro_selos_origem_unica_idx
  on public.livro_selos_movimentos (origem_tipo, origem_id, tipo, insumo_id)
  where origem_id is not null;
create index if not exists livro_selos_data_idx
  on public.livro_selos_movimentos (data_movimento desc, criado_em desc);
create index if not exists livro_selos_insumo_idx
  on public.livro_selos_movimentos (insumo_id, data_movimento desc);

alter table public.livro_selos_movimentos enable row level security;
drop policy if exists livro_selos_admin on public.livro_selos_movimentos;
drop policy if exists livro_selos_admin_select on public.livro_selos_movimentos;
drop policy if exists livro_selos_admin_insert on public.livro_selos_movimentos;
create policy livro_selos_admin_select on public.livro_selos_movimentos
for select to authenticated using (public.is_admin());
create policy livro_selos_admin_insert on public.livro_selos_movimentos
for insert to authenticated with check (public.is_admin());

-- Campos necessarios para que a saida fiscal possa exibir exatamente a NF-e.
alter table public.pedidos
  add column if not exists bling_nfe_serie text,
  add column if not exists bling_nfe_data_emissao date;

-- O saldo ja existente vira saldo inicial. Nenhuma quantidade e adicionada ao
-- estoque: em especial, os 3.000 selos de Aguardente nao sao duplicados.
insert into public.livro_selos_movimentos (
  insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,
  grupo,subgrupo,origem_tipo,origem_id,observacoes
)
select i.id,current_date,'saldo_inicial',i.quantidade,i.quantidade,
       case when i.codigo='selo_ipi_aguardente' then 'Bebidas alcoolicas' else 'Bebidas mistas' end,
       case when i.codigo='selo_ipi_aguardente' then 'Aguardente' else 'Bebida mista' end,
       'migracao','saldo-inicial-'||i.codigo,
       'Saldo existente incorporado ao Livro Modelo 4 sem alterar o estoque fisico.'
from public.insumos_envase i
where i.codigo like 'selo_ipi_%' and i.quantidade > 0
on conflict do nothing;

create or replace function public.registrar_movimento_manual_selo(
  p_insumo uuid,
  p_tipo text,
  p_quantidade integer,
  p_data date,
  p_guia_numero text default null,
  p_guia_data date default null,
  p_numeracao_inicial bigint default null,
  p_numeracao_final bigint default null,
  p_grupo text default null,
  p_subgrupo text default null,
  p_cor text default null,
  p_serie text default null,
  p_observacoes text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_insumo public.insumos_envase%rowtype;
  v_delta integer;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if p_tipo not in ('entrada','inutilizacao','devolucao','ajuste_positivo','ajuste_negativo') then
    raise exception 'Tipo de movimento invalido';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe uma quantidade valida'; end if;
  if p_data is null then raise exception 'Informe a data do movimento'; end if;
  if p_numeracao_inicial is not null and p_numeracao_final is not null
     and (p_numeracao_final < p_numeracao_inicial or p_numeracao_final-p_numeracao_inicial+1 <> p_quantidade) then
    raise exception 'A faixa de numeracao deve corresponder a quantidade informada';
  end if;

  select * into v_insumo from public.insumos_envase where id=p_insumo for update;
  if not found or v_insumo.codigo not like 'selo_ipi_%' then raise exception 'Tipo de selo nao encontrado'; end if;
  v_delta := case when p_tipo in ('entrada','ajuste_positivo') then p_quantidade else -p_quantidade end;
  if v_insumo.quantidade + v_delta < 0 then raise exception 'Saldo fisico insuficiente para este movimento'; end if;

  update public.insumos_envase set quantidade=quantidade+v_delta,atualizado_em=now() where id=p_insumo;
  insert into public.movimentos_insumos_envase(insumo_id,quantidade,motivo,criado_por)
  values(p_insumo,v_delta,'Livro Modelo 4 · '||replace(p_tipo,'_',' '),auth.uid());

  insert into public.livro_selos_movimentos(
    insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,
    guia_numero,guia_data,numeracao_inicial,numeracao_final,grupo,subgrupo,cor,serie,
    origem_tipo,observacoes,criado_por,criado_por_email
  ) values (
    p_insumo,p_data,p_tipo,p_quantidade,v_delta,
    nullif(trim(coalesce(p_guia_numero,'')),''),p_guia_data,p_numeracao_inicial,p_numeracao_final,
    nullif(trim(coalesce(p_grupo,'')),''),nullif(trim(coalesce(p_subgrupo,'')),''),
    nullif(trim(coalesce(p_cor,'')),''),nullif(trim(coalesce(p_serie,'')),''),
    'manual',nullif(trim(coalesce(p_observacoes,'')),''),auth.uid(),auth.jwt()->>'email'
  ) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.registrar_movimento_manual_selo(uuid,text,integer,date,text,date,bigint,bigint,text,text,text,text,text) from public,anon;
grant execute on function public.registrar_movimento_manual_selo(uuid,text,integer,date,text,date,bigint,bigint,text,text,text,text,text) to authenticated;

create or replace function public.livro_selos_registrar_envase()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_insumo uuid;
begin
  select r.insumo_id into v_insumo
  from public.receitas_envase r join public.insumos_envase i on i.id=r.insumo_id
  where r.produto_bling_id=new.produto_bling_id and r.tipo_consumo='selos'
  limit 1;
  if v_insumo is null then return new; end if;

  if new.selos_aplicados > 0 then
    insert into public.livro_selos_movimentos(
      insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,envase_id,
      origem_tipo,origem_id,observacoes,criado_por,criado_por_email
    ) values (
      v_insumo,new.data_envase,'aplicacao_envase',new.selos_aplicados,0,new.id,
      'envase',new.id::text,'Aplicados no lote '||new.lote,new.criado_por,auth.jwt()->>'email'
    ) on conflict do nothing;
  end if;
  if new.selos_perdidos > 0 then
    insert into public.livro_selos_movimentos(
      insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,envase_id,
      origem_tipo,origem_id,observacoes,criado_por,criado_por_email
    ) values (
      v_insumo,new.data_envase,'inutilizacao',new.selos_perdidos,-new.selos_perdidos,new.id,
      'envase_perda',new.id::text,'Perdidos/inutilizados no lote '||new.lote,new.criado_por,auth.jwt()->>'email'
    ) on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists livro_selos_apos_envase on public.envases;
create trigger livro_selos_apos_envase after insert on public.envases
for each row execute function public.livro_selos_registrar_envase();

-- Compras registradas na central de notas tambem entram no livro. A nota de
-- compra funciona como origem documental, sem exigir um segundo lancamento.
create or replace function public.livro_selos_registrar_compra()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_insumo public.insumos_envase%rowtype; v_compra public.compras_insumos%rowtype;
begin
  select * into v_insumo from public.insumos_envase where id=new.insumo_id;
  if not found or v_insumo.codigo not like 'selo_ipi_%' then return new; end if;
  select * into v_compra from public.compras_insumos where id=new.compra_id;
  insert into public.livro_selos_movimentos(
    insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,guia_numero,guia_data,
    grupo,subgrupo,origem_tipo,origem_id,observacoes,criado_por,criado_por_email
  ) values (
    new.insumo_id,v_compra.data_emissao,'entrada',new.quantidade,new.quantidade,
    v_compra.numero_documento,v_compra.data_emissao,
    case when v_insumo.codigo='selo_ipi_aguardente' then 'Bebidas alcoolicas' else 'Bebidas mistas' end,
    case when v_insumo.codigo='selo_ipi_aguardente' then 'Aguardente' else 'Bebida mista' end,
    'compra_insumos',new.id::text,
    'Entrada vinculada a compra de '||v_compra.fornecedor,v_compra.criado_por,auth.jwt()->>'email'
  ) on conflict do nothing;
  return new;
end $$;

drop trigger if exists livro_selos_apos_compra on public.compra_insumo_itens;
create trigger livro_selos_apos_compra after insert on public.compra_insumo_itens
for each row execute function public.livro_selos_registrar_compra();

-- Ajustes feitos pela tela antiga de insumos continuam auditados. Compras,
-- envases e lancamentos do proprio livro sao ignorados aqui porque possuem
-- gatilhos especificos com mais dados.
create or replace function public.livro_selos_registrar_ajuste_legado()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_insumo public.insumos_envase%rowtype; v_tipo text;
begin
  if new.envase_id is not null or new.motivo like 'Compra de insumos%' or new.motivo like 'Livro Modelo 4%' then return new; end if;
  select * into v_insumo from public.insumos_envase where id=new.insumo_id;
  if not found or v_insumo.codigo not like 'selo_ipi_%' or new.quantidade=0 then return new; end if;
  v_tipo := case when new.quantidade>0 then 'ajuste_positivo' else 'ajuste_negativo' end;
  insert into public.livro_selos_movimentos(
    insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,grupo,subgrupo,
    origem_tipo,origem_id,observacoes,criado_por,criado_por_email
  ) values (
    new.insumo_id,new.criado_em::date,v_tipo,abs(new.quantidade),new.quantidade,
    case when v_insumo.codigo='selo_ipi_aguardente' then 'Bebidas alcoolicas' else 'Bebidas mistas' end,
    case when v_insumo.codigo='selo_ipi_aguardente' then 'Aguardente' else 'Bebida mista' end,
    'ajuste_insumo',new.id::text,new.motivo,new.criado_por,auth.jwt()->>'email'
  ) on conflict do nothing;
  return new;
end $$;

drop trigger if exists livro_selos_apos_ajuste_legado on public.movimentos_insumos_envase;
create trigger livro_selos_apos_ajuste_legado after insert on public.movimentos_insumos_envase
for each row execute function public.livro_selos_registrar_ajuste_legado();

create or replace function public.livro_selos_registrar_estorno_envase()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_mov record; v_quantidade integer;
begin
  if old.estornado_em is not null or new.estornado_em is null then return new; end if;
  for v_mov in
    select * from public.livro_selos_movimentos
    where envase_id=new.id and tipo in ('aplicacao_envase','inutilizacao')
  loop
    v_quantidade := case when coalesce(new.garrafas_estornadas,0)>0 and new.garrafas_estornadas<new.garrafas
      then floor(v_mov.quantidade::numeric*new.garrafas_estornadas/new.garrafas)::integer
      else v_mov.quantidade end;
    if v_quantidade > 0 then
      insert into public.livro_selos_movimentos(
        insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,envase_id,
        origem_tipo,origem_id,observacoes,criado_por,criado_por_email
      ) values (
        v_mov.insumo_id,current_date,'estorno_envase',v_quantidade,
        case when v_mov.tipo='inutilizacao' then v_quantidade else 0 end,new.id,
        'estorno_envase',new.id::text||'-'||v_mov.tipo,
        coalesce(new.motivo_estorno,'Estorno do envase'),new.estornado_por,auth.jwt()->>'email'
      ) on conflict do nothing;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists livro_selos_apos_estorno_envase on public.envases;
create trigger livro_selos_apos_estorno_envase after update of estornado_em on public.envases
for each row execute function public.livro_selos_registrar_estorno_envase();

-- Vincula a saida fiscal somente quando a NF-e fica autorizada. A quantidade
-- considera componentes de kits e encontra o tipo de selo pela receita.
create or replace function public.livro_selos_registrar_nfe()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_linha record; v_tipo text; v_id_origem text;
begin
  if new.bling_nfe_id is null then return new; end if;
  v_id_origem := new.id::text||'-'||new.bling_nfe_id;

  if new.bling_nfe_status in ('5','6') and coalesce(old.bling_nfe_status,'') not in ('5','6') then
    for v_linha in
      with itens as (
        select value item from jsonb_array_elements(coalesce(new.itens_json,'[]'::jsonb))
      ), componentes as (
        select coalesce(c->>'bling_id',item->>'bling_id') bling_id,
               greatest(1,coalesce((item->>'quantidade')::integer,1))*greatest(1,coalesce((c->>'quantidade')::integer,1)) quantidade
        from itens
        left join lateral jsonb_array_elements(
          case when jsonb_typeof(item->'componentes')='array' and jsonb_array_length(item->'componentes')>0
            then item->'componentes' else jsonb_build_array(jsonb_build_object('bling_id',item->>'bling_id','quantidade',1)) end
        ) c on true
      )
      select r.insumo_id,sum(componentes.quantidade)::integer quantidade
      from componentes join public.receitas_envase r on r.produto_bling_id=componentes.bling_id and r.tipo_consumo='selos'
      group by r.insumo_id
    loop
      insert into public.livro_selos_movimentos(
        insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,nfe_numero,nfe_serie,pedido_id,
        origem_tipo,origem_id,observacoes,criado_por_email
      ) values (
        v_linha.insumo_id,coalesce(new.bling_nfe_data_emissao,current_date),'saida_fiscal',v_linha.quantidade,-v_linha.quantidade,
        new.bling_nfe_numero,new.bling_nfe_serie,new.id,'nfe',v_id_origem,
        'Saida fiscal vinculada ao pedido '||coalesce(new.referencia,new.id::text),auth.jwt()->>'email'
      ) on conflict do nothing;
    end loop;
  elsif new.bling_nfe_status='2' and old.bling_nfe_status in ('5','6') then
    for v_linha in select * from public.livro_selos_movimentos
      where pedido_id=new.id and origem_tipo='nfe' and tipo='saida_fiscal'
    loop
      insert into public.livro_selos_movimentos(
        insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,nfe_numero,nfe_serie,pedido_id,
        origem_tipo,origem_id,observacoes,criado_por_email
      ) values (
        v_linha.insumo_id,current_date,'estorno_saida_fiscal',v_linha.quantidade,v_linha.quantidade,
        new.bling_nfe_numero,new.bling_nfe_serie,new.id,'cancelamento_nfe',v_id_origem,
        'Estorno fiscal por cancelamento da NF-e',auth.jwt()->>'email'
      ) on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists livro_selos_apos_nfe on public.pedidos;
create trigger livro_selos_apos_nfe after update of bling_nfe_status on public.pedidos
for each row execute function public.livro_selos_registrar_nfe();

comment on table public.livro_selos_movimentos is
  'Livro continuo Modelo 4. Registros sao estornados por novos lancamentos e nunca apagados.';

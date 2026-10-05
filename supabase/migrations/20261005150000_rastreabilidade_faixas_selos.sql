-- Rastreabilidade dos selos por lote recebido e por faixa consumida no envase.
-- O Livro Modelo 4 e os saldos existentes eram apenas de homologacao/teste;
-- por autorizacao do administrador, o novo controle comeca zerado.

create extension if not exists btree_gist;

alter table public.livro_selos_movimentos
  add column if not exists numeracao_largura integer;

create table if not exists public.selos_lotes (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos_envase(id) on delete restrict,
  movimento_entrada_id uuid unique references public.livro_selos_movimentos(id) on delete restrict,
  data_entrada date not null,
  guia_numero text not null,
  guia_data date not null,
  grupo text,
  subgrupo text,
  cor text,
  serie text not null,
  numeracao_inicial bigint not null,
  numeracao_final bigint not null,
  numeracao_largura integer not null default 1,
  proximo_numero bigint not null,
  quantidade_total integer not null,
  quantidade_disponivel integer not null,
  status text not null default 'ativo' check (status in ('ativo','esgotado','cancelado')),
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  check (numeracao_inicial >= 0 and numeracao_final >= numeracao_inicial),
  check (numeracao_largura > 0),
  check (quantidade_total = numeracao_final-numeracao_inicial+1),
  check (quantidade_disponivel >= 0 and quantidade_disponivel <= quantidade_total),
  check (proximo_numero >= numeracao_inicial and proximo_numero <= numeracao_final+1)
);

alter table public.selos_lotes drop constraint if exists selos_lotes_sem_sobreposicao;
alter table public.selos_lotes add constraint selos_lotes_sem_sobreposicao
  exclude using gist (
    insumo_id with =,
    serie with =,
    int8range(numeracao_inicial,numeracao_final,'[]') with &&
  ) where (status <> 'cancelado');

create index if not exists selos_lotes_disponiveis_idx
  on public.selos_lotes(insumo_id,status,serie,proximo_numero);

create table if not exists public.selos_faixas_utilizadas (
  id uuid primary key default gen_random_uuid(),
  lote_selo_id uuid not null references public.selos_lotes(id) on delete restrict,
  insumo_id uuid not null references public.insumos_envase(id) on delete restrict,
  envase_id uuid references public.envases(id) on delete restrict,
  movimento_id uuid references public.livro_selos_movimentos(id) on delete set null,
  finalidade text not null check (finalidade in ('envase','inutilizacao','devolucao','ajuste_negativo')),
  serie text not null,
  numeracao_inicial bigint not null,
  numeracao_final bigint not null,
  numeracao_largura integer not null default 1,
  quantidade_aplicada integer not null default 0 check (quantidade_aplicada >= 0),
  quantidade_inutilizada integer not null default 0 check (quantidade_inutilizada >= 0),
  codigos_inutilizados bigint[] not null default '{}',
  observacoes text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  check (numeracao_final >= numeracao_inicial),
  check (quantidade_aplicada+quantidade_inutilizada = numeracao_final-numeracao_inicial+1)
);

alter table public.selos_faixas_utilizadas drop constraint if exists selos_faixas_sem_sobreposicao;
alter table public.selos_faixas_utilizadas add constraint selos_faixas_sem_sobreposicao
  exclude using gist (
    insumo_id with =,
    serie with =,
    int8range(numeracao_inicial,numeracao_final,'[]') with &&
  );

create index if not exists selos_faixas_envase_idx
  on public.selos_faixas_utilizadas(envase_id,criado_em);

alter table public.selos_lotes enable row level security;
alter table public.selos_faixas_utilizadas enable row level security;
drop policy if exists selos_lotes_admin_select on public.selos_lotes;
drop policy if exists selos_faixas_admin_select on public.selos_faixas_utilizadas;
create policy selos_lotes_admin_select on public.selos_lotes
  for select to authenticated using (public.is_admin());
create policy selos_faixas_admin_select on public.selos_faixas_utilizadas
  for select to authenticated using (public.is_admin());

-- Reinicializacao autorizada: remove somente historico/saldos de selos usados
-- em testes. Envases, pedidos, notas e demais insumos nao sao apagados.
delete from public.livro_selos_movimentos;
delete from public.livro_selos_backups;
delete from public.movimentos_insumos_envase
where insumo_id in (select id from public.insumos_envase where codigo like 'selo_ipi_%');
update public.insumos_envase
set quantidade=0, atualizado_em=now()
where codigo like 'selo_ipi_%';

drop function if exists public.registrar_movimento_manual_selo(uuid,text,integer,date,text,date,bigint,bigint,text,text,text,text,text);
drop function if exists public.registrar_movimento_manual_selo(uuid,text,integer,date,text,date,bigint,bigint,text,text,text,text,integer,text);

create function public.registrar_movimento_manual_selo(
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
  p_numeracao_largura integer default null,
  p_observacoes text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_insumo public.insumos_envase%rowtype;
  v_lote public.selos_lotes%rowtype;
  v_delta integer;
  v_id uuid;
  v_largura integer;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if p_tipo not in ('entrada','inutilizacao','devolucao','ajuste_negativo') then
    raise exception 'Entradas positivas devem possuir uma nova faixa numerada';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe uma quantidade valida'; end if;
  if p_data is null then raise exception 'Informe a data do movimento'; end if;
  if p_numeracao_inicial is null or p_numeracao_final is null or trim(coalesce(p_serie,''))='' then
    raise exception 'Serie, numeracao inicial e numeracao final sao obrigatorias';
  end if;
  if p_numeracao_final < p_numeracao_inicial or p_numeracao_final-p_numeracao_inicial+1 <> p_quantidade then
    raise exception 'A faixa de numeracao deve corresponder a quantidade informada';
  end if;
  v_largura := greatest(coalesce(p_numeracao_largura,1),length(p_numeracao_final::text));

  select * into v_insumo from public.insumos_envase where id=p_insumo for update;
  if not found or v_insumo.codigo not like 'selo_ipi_%' then raise exception 'Tipo de selo nao encontrado'; end if;

  if p_tipo='entrada' then
    if trim(coalesce(p_guia_numero,''))='' or p_guia_data is null then
      raise exception 'Numero e data da guia sao obrigatorios na entrada';
    end if;
    v_delta := p_quantidade;
  else
    v_delta := -p_quantidade;
    select * into v_lote
    from public.selos_lotes
    where insumo_id=p_insumo and status='ativo' and serie=trim(p_serie)
      and p_numeracao_inicial>=numeracao_inicial and p_numeracao_final<=numeracao_final
    for update;
    if not found then raise exception 'A faixa nao pertence a um lote de selos disponivel'; end if;
    if p_numeracao_inicial<>v_lote.proximo_numero then
      raise exception 'Use a ordem crescente. O proximo selo disponivel e %',lpad(v_lote.proximo_numero::text,v_lote.numeracao_largura,'0');
    end if;
    if v_insumo.quantidade < p_quantidade then raise exception 'Saldo fisico insuficiente'; end if;
  end if;

  update public.insumos_envase set quantidade=quantidade+v_delta,atualizado_em=now() where id=p_insumo;
  insert into public.movimentos_insumos_envase(insumo_id,quantidade,motivo,criado_por)
  values(p_insumo,v_delta,'Livro Modelo 4 · '||replace(p_tipo,'_',' '),auth.uid());

  insert into public.livro_selos_movimentos(
    insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,
    guia_numero,guia_data,numeracao_inicial,numeracao_final,numeracao_largura,
    grupo,subgrupo,cor,serie,origem_tipo,observacoes,criado_por,criado_por_email
  ) values (
    p_insumo,p_data,p_tipo,p_quantidade,v_delta,
    nullif(trim(coalesce(p_guia_numero,'')),''),p_guia_data,p_numeracao_inicial,p_numeracao_final,v_largura,
    nullif(trim(coalesce(p_grupo,'')),''),nullif(trim(coalesce(p_subgrupo,'')),''),
    nullif(trim(coalesce(p_cor,'')),''),trim(p_serie),
    'manual',nullif(trim(coalesce(p_observacoes,'')),''),auth.uid(),auth.jwt()->>'email'
  ) returning id into v_id;

  if p_tipo='entrada' then
    insert into public.selos_lotes(
      insumo_id,movimento_entrada_id,data_entrada,guia_numero,guia_data,grupo,subgrupo,cor,serie,
      numeracao_inicial,numeracao_final,numeracao_largura,proximo_numero,
      quantidade_total,quantidade_disponivel,observacoes,criado_por
    ) values (
      p_insumo,v_id,p_data,trim(p_guia_numero),p_guia_data,
      nullif(trim(coalesce(p_grupo,'')),''),nullif(trim(coalesce(p_subgrupo,'')),''),
      nullif(trim(coalesce(p_cor,'')),''),trim(p_serie),
      p_numeracao_inicial,p_numeracao_final,v_largura,p_numeracao_inicial,
      p_quantidade,p_quantidade,nullif(trim(coalesce(p_observacoes,'')),''),auth.uid()
    );
  else
    update public.selos_lotes
    set proximo_numero=p_numeracao_final+1,
        quantidade_disponivel=quantidade_disponivel-p_quantidade,
        status=case when quantidade_disponivel-p_quantidade=0 then 'esgotado' else 'ativo' end
    where id=v_lote.id;
    insert into public.selos_faixas_utilizadas(
      lote_selo_id,insumo_id,movimento_id,finalidade,serie,numeracao_inicial,numeracao_final,
      numeracao_largura,quantidade_inutilizada,observacoes,criado_por
    ) values (
      v_lote.id,p_insumo,v_id,p_tipo,trim(p_serie),p_numeracao_inicial,p_numeracao_final,
      v_largura,p_quantidade,p_observacoes,auth.uid()
    );
  end if;
  return v_id;
end $$;

revoke all on function public.registrar_movimento_manual_selo(uuid,text,integer,date,text,date,bigint,bigint,text,text,text,text,integer,text) from public,anon;
grant execute on function public.registrar_movimento_manual_selo(uuid,text,integer,date,text,date,bigint,bigint,text,text,text,text,integer,text) to authenticated;

drop trigger if exists livro_selos_apos_envase on public.envases;

drop function if exists public.registrar_envase(text,text,text,date,integer,integer,integer,text,text);
drop function if exists public.registrar_envase(text,text,text,date,integer,integer,integer,text,text,uuid,bigint,bigint,bigint[]);

create function public.registrar_envase(
  p_produto_bling_id text, p_produto_nome text, p_lote text, p_data date,
  p_garrafas integer, p_selos_aplicados integer, p_selos_perdidos integer,
  p_deposito_bling_id text, p_observacoes text,
  p_selo_lote uuid, p_selo_num_inicial bigint, p_selo_num_final bigint,
  p_selos_perdidos_numeros bigint[] default '{}'
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_envase uuid;
  v_item record;
  v_consumo integer;
  v_total_itens integer;
  v_selo_insumo uuid;
  v_lote public.selos_lotes%rowtype;
  v_total_faixa integer;
  v_qtd_codigos integer;
  v_qtd_codigos_unicos integer;
  v_codigos_perdidos bigint[] := coalesce(p_selos_perdidos_numeros,'{}'::bigint[]);
  v_codigos_texto text;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if p_garrafas <= 0 or p_selos_aplicados < 0 or p_selos_perdidos < 0 then raise exception 'Quantidades invalidas'; end if;
  if p_selos_aplicados<>p_garrafas then raise exception 'A quantidade de selos aplicados deve ser igual a quantidade de garrafas'; end if;
  if trim(coalesce(p_lote,''))='' or trim(coalesce(p_deposito_bling_id,''))='' then raise exception 'Lote e deposito sao obrigatorios'; end if;
  if p_selo_lote is null or p_selo_num_inicial is null or p_selo_num_final is null then raise exception 'Informe o lote e o intervalo dos selos'; end if;

  select count(*) into v_total_itens from public.receitas_envase where produto_bling_id=p_produto_bling_id;
  if v_total_itens=0 then raise exception 'Este produto ainda nao possui receita de envase configurada'; end if;
  select insumo_id into v_selo_insumo from public.receitas_envase
  where produto_bling_id=p_produto_bling_id and tipo_consumo='selos' limit 1;
  if v_selo_insumo is null then raise exception 'A receita do produto nao possui tipo de selo'; end if;

  select * into v_lote from public.selos_lotes where id=p_selo_lote for update;
  if not found or v_lote.status<>'ativo' then raise exception 'O lote de selos selecionado nao esta disponivel'; end if;
  if v_lote.insumo_id<>v_selo_insumo then raise exception 'O lote selecionado pertence a outro tipo de selo'; end if;
  if p_selo_num_inicial<>v_lote.proximo_numero then
    raise exception 'Use a ordem crescente. O proximo selo deste lote e %',lpad(v_lote.proximo_numero::text,v_lote.numeracao_largura,'0');
  end if;
  if p_selo_num_final>v_lote.numeracao_final or p_selo_num_final<p_selo_num_inicial then raise exception 'Intervalo fora do lote recebido'; end if;
  v_total_faixa := (p_selo_num_final-p_selo_num_inicial+1)::integer;
  if v_total_faixa<>p_selos_aplicados+p_selos_perdidos then raise exception 'O intervalo deve conter os selos aplicados mais os perdidos'; end if;
  select count(*),count(distinct codigo) into v_qtd_codigos,v_qtd_codigos_unicos from unnest(v_codigos_perdidos) codigo;
  if v_qtd_codigos<>p_selos_perdidos or v_qtd_codigos_unicos<>p_selos_perdidos then raise exception 'Informe uma vez cada codigo de selo perdido'; end if;
  if exists(select 1 from unnest(v_codigos_perdidos) codigo where codigo<p_selo_num_inicial or codigo>p_selo_num_final) then
    raise exception 'Todos os selos perdidos devem pertencer ao intervalo do envase';
  end if;

  for v_item in
    select receita.*,insumo.nome,insumo.codigo,insumo.quantidade
    from public.receitas_envase receita join public.insumos_envase insumo on insumo.id=receita.insumo_id
    where receita.produto_bling_id=p_produto_bling_id for update of insumo
  loop
    v_consumo := case when v_item.tipo_consumo='selos'
      then v_total_faixa else p_garrafas*v_item.quantidade_por_garrafa end;
    if v_item.quantidade<v_consumo then raise exception 'Saldo insuficiente de %',v_item.nome; end if;
  end loop;

  insert into public.envases(produto_bling_id,produto_nome,lote,data_envase,garrafas,selos_aplicados,selos_perdidos,deposito_bling_id,observacoes,criado_por)
  values(p_produto_bling_id,p_produto_nome,trim(p_lote),p_data,p_garrafas,p_selos_aplicados,p_selos_perdidos,p_deposito_bling_id,p_observacoes,auth.uid())
  returning id into v_envase;

  insert into public.selos_faixas_utilizadas(
    lote_selo_id,insumo_id,envase_id,finalidade,serie,numeracao_inicial,numeracao_final,
    numeracao_largura,quantidade_aplicada,quantidade_inutilizada,codigos_inutilizados,observacoes,criado_por
  ) values (
    v_lote.id,v_selo_insumo,v_envase,'envase',v_lote.serie,p_selo_num_inicial,p_selo_num_final,
    v_lote.numeracao_largura,p_selos_aplicados,p_selos_perdidos,v_codigos_perdidos,p_observacoes,auth.uid()
  );

  update public.selos_lotes
  set proximo_numero=p_selo_num_final+1,
      quantidade_disponivel=quantidade_disponivel-v_total_faixa,
      status=case when quantidade_disponivel-v_total_faixa=0 then 'esgotado' else 'ativo' end
  where id=v_lote.id;

  for v_item in
    select receita.*,insumo.nome from public.receitas_envase receita
    join public.insumos_envase insumo on insumo.id=receita.insumo_id
    where receita.produto_bling_id=p_produto_bling_id
  loop
    v_consumo := case when v_item.tipo_consumo='selos'
      then v_total_faixa else p_garrafas*v_item.quantidade_por_garrafa end;
    update public.insumos_envase set quantidade=quantidade-v_consumo,atualizado_em=now() where id=v_item.insumo_id;
    insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
    values(v_item.insumo_id,v_envase,-v_consumo,'Envase lote '||trim(p_lote),auth.uid());
  end loop;

  insert into public.livro_selos_movimentos(
    insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,envase_id,
    numeracao_inicial,numeracao_final,numeracao_largura,grupo,subgrupo,cor,serie,
    origem_tipo,origem_id,observacoes,criado_por,criado_por_email
  ) values (
    v_selo_insumo,p_data,'aplicacao_envase',p_selos_aplicados,0,v_envase,
    p_selo_num_inicial,p_selo_num_final,v_lote.numeracao_largura,v_lote.grupo,v_lote.subgrupo,v_lote.cor,v_lote.serie,
    'envase',v_envase::text,'Aplicados no lote de produto '||trim(p_lote),auth.uid(),auth.jwt()->>'email'
  );

  if p_selos_perdidos>0 then
    select string_agg(lpad(codigo::text,v_lote.numeracao_largura,'0'),', ' order by codigo)
      into v_codigos_texto from unnest(v_codigos_perdidos) codigo;
    insert into public.livro_selos_movimentos(
      insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,envase_id,
      numeracao_inicial,numeracao_final,numeracao_largura,grupo,subgrupo,cor,serie,
      origem_tipo,origem_id,observacoes,criado_por,criado_por_email
    ) values (
      v_selo_insumo,p_data,'inutilizacao',p_selos_perdidos,-p_selos_perdidos,v_envase,
      p_selo_num_inicial,p_selo_num_final,v_lote.numeracao_largura,v_lote.grupo,v_lote.subgrupo,v_lote.cor,v_lote.serie,
      'envase_perda',v_envase::text,'Selos perdidos/inutilizados: '||v_codigos_texto,auth.uid(),auth.jwt()->>'email'
    );
  end if;
  return v_envase;
end $$;

revoke all on function public.registrar_envase(text,text,text,date,integer,integer,integer,text,text,uuid,bigint,bigint,bigint[]) from public,anon;
grant execute on function public.registrar_envase(text,text,text,date,integer,integer,integer,text,text,uuid,bigint,bigint,bigint[]) to authenticated;

create or replace function public.estornar_envase_parcial(p_envase uuid,p_quantidade integer,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_envase public.envases%rowtype; v_mov record; v_devolucao integer;
begin
  if auth.role()<>'service_role' and not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if length(trim(coalesce(p_motivo,'')))<3 then raise exception 'Informe o motivo do estorno'; end if;
  select * into v_envase from public.envases where id=p_envase for update;
  if not found then raise exception 'Envase nao encontrado'; end if;
  if v_envase.estornado_em is not null then raise exception 'Envase ja encerrado por estorno'; end if;
  if p_quantidade is null or p_quantidade<1 or p_quantidade>v_envase.garrafas then raise exception 'Quantidade de estorno invalida'; end if;

  -- Selos aplicados/inutilizados permanecem consumidos. Somente os demais
  -- insumos recuperaveis retornam ao estoque.
  for v_mov in
    select m.insumo_id,-sum(m.quantidade)::integer consumo
    from public.movimentos_insumos_envase m join public.insumos_envase i on i.id=m.insumo_id
    where m.envase_id=p_envase and m.quantidade<0 and i.codigo not like 'selo_ipi_%'
    group by m.insumo_id
  loop
    v_devolucao := case when p_quantidade=v_envase.garrafas then v_mov.consumo
      else floor((v_mov.consumo::numeric*p_quantidade)/v_envase.garrafas)::integer end;
    if v_devolucao>0 then
      update public.insumos_envase set quantidade=quantidade+v_devolucao,atualizado_em=now() where id=v_mov.insumo_id;
      insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
      values(v_mov.insumo_id,p_envase,v_devolucao,
        case when p_quantidade=v_envase.garrafas then 'Estorno total: ' else 'Estorno parcial: ' end||trim(p_motivo),
        case when auth.role()='service_role' then null else auth.uid() end);
    end if;
  end loop;

  update public.envases set estornado_em=now(),estornado_por=case when auth.role()='service_role' then null else auth.uid() end,
    motivo_estorno=trim(p_motivo),garrafas_estornadas=p_quantidade,
    estorno_tipo=case when p_quantidade=garrafas then 'total' else 'parcial' end,
    estorno_bling_status=case when bling_status='sincronizado' then 'sincronizado' else null end,estorno_bling_erro=null
  where id=p_envase;
  return jsonb_build_object('ok',true,'produto_bling_id',v_envase.produto_bling_id,'deposito_bling_id',v_envase.deposito_bling_id,
    'garrafas_originais',v_envase.garrafas,'garrafas_estornadas',p_quantidade,'garrafas_mantidas',v_envase.garrafas-p_quantidade,
    'tipo',case when p_quantidade=v_envase.garrafas then 'total' else 'parcial' end,'selos_devolvidos',0);
end $$;

create or replace function public.livro_selos_registrar_estorno_envase()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_faixa record; v_quantidade integer;
begin
  if old.estornado_em is not null or new.estornado_em is null then return new; end if;
  v_quantidade := least(coalesce(new.garrafas_estornadas,new.garrafas),new.selos_aplicados);
  if v_quantidade<=0 then return new; end if;
  select f.*,l.grupo,l.subgrupo,l.cor into v_faixa
  from public.selos_faixas_utilizadas f join public.selos_lotes l on l.id=f.lote_selo_id
  where f.envase_id=new.id and f.finalidade='envase' limit 1;
  if not found then return new; end if;
  insert into public.livro_selos_movimentos(
    insumo_id,data_movimento,tipo,quantidade,impacto_saldo_fiscal,envase_id,
    numeracao_inicial,numeracao_final,numeracao_largura,grupo,subgrupo,cor,serie,
    origem_tipo,origem_id,observacoes,criado_por,criado_por_email
  ) values (
    v_faixa.insumo_id,current_date,'estorno_envase',v_quantidade,-v_quantidade,new.id,
    v_faixa.numeracao_inicial,v_faixa.numeracao_final,v_faixa.numeracao_largura,
    v_faixa.grupo,v_faixa.subgrupo,v_faixa.cor,v_faixa.serie,
    'estorno_envase',new.id::text,
    'Envase estornado; os selos aplicados permanecem consumidos e foram classificados como inutilizados. '||coalesce(new.motivo_estorno,''),
    new.estornado_por,auth.jwt()->>'email'
  ) on conflict do nothing;
  return new;
end $$;

create or replace function public.ajustar_insumo_envase(p_insumo uuid,p_quantidade integer,p_motivo text default 'Ajuste manual')
returns void language plpgsql security definer set search_path=public as $$
declare v_anterior integer; v_codigo text;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if p_quantidade<0 then raise exception 'Quantidade invalida'; end if;
  select quantidade,codigo into v_anterior,v_codigo from public.insumos_envase where id=p_insumo for update;
  if not found then raise exception 'Insumo nao encontrado'; end if;
  if v_codigo like 'selo_ipi_%' then
    raise exception 'O saldo deste selo e controlado por faixas. Registre a movimentacao no Livro de Selos';
  end if;
  update public.insumos_envase set quantidade=p_quantidade,atualizado_em=now() where id=p_insumo;
  insert into public.movimentos_insumos_envase(insumo_id,quantidade,motivo,criado_por)
  values(p_insumo,p_quantidade-v_anterior,coalesce(nullif(trim(p_motivo),''),'Ajuste manual'),auth.uid());
end $$;

create or replace function public.impedir_compra_selo_sem_faixa()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.insumos_envase where id=new.insumo_id and codigo like 'selo_ipi_%') then
    raise exception 'Entradas de selo devem ser registradas no Livro de Selos com serie e intervalo';
  end if;
  return new;
end $$;

drop trigger if exists impedir_compra_selo_sem_faixa on public.compra_insumo_itens;
create trigger impedir_compra_selo_sem_faixa before insert on public.compra_insumo_itens
for each row execute function public.impedir_compra_selo_sem_faixa();

comment on table public.selos_lotes is 'Faixas numeradas recebidas por guia para consumo sequencial.';
comment on table public.selos_faixas_utilizadas is 'Intervalos consumidos e vinculados ao envase ou a outra baixa fiscal.';

-- O documento de fornecimento passa a ser arquivado em Notas / Contabilidade.
-- A rastreabilidade operacional permanece baseada em tipo, serie e intervalo.

alter table public.selos_lotes
  alter column guia_numero drop not null,
  alter column guia_data drop not null;

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
      p_insumo,v_id,p_data,nullif(trim(coalesce(p_guia_numero,'')),''),p_guia_data,
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

comment on column public.selos_lotes.guia_numero is 'Opcional. O documento de fornecimento pode ser arquivado em Notas / Contabilidade.';
comment on column public.selos_lotes.guia_data is 'Opcional. A data operacional do recebimento permanece em data_entrada.';

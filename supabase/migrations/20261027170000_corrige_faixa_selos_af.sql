-- Corrige a faixa AF recebida sem alterar as faixas ja vinculadas a envases.
--
-- Cadastro anterior: 08027351 a 08030350 (3.000 selos)
-- Faixa recebida:    08027301 a 08030300 (3.000 selos)
--
-- Os envases existentes a partir de 08027351 permanecem intactos. Os 50
-- numeros anteriores passam a compor um lote complementar independente e os
-- 50 numeros finais que nunca foram recebidos deixam de integrar o saldo.

create table if not exists public.selos_correcoes_faixa (
  id uuid primary key default gen_random_uuid(),
  lote_original_id uuid not null references public.selos_lotes(id) on delete restrict,
  lote_complementar_id uuid references public.selos_lotes(id) on delete restrict,
  insumo_id uuid not null references public.insumos_envase(id) on delete restrict,
  serie text not null,
  faixa_cadastrada_inicial bigint not null,
  faixa_cadastrada_final bigint not null,
  faixa_correta_inicial bigint not null,
  faixa_correta_final bigint not null,
  proximo_numero_preservado bigint not null,
  saldo_disponivel_anterior integer not null,
  saldo_disponivel_posterior integer not null,
  estado_anterior jsonb not null,
  estado_posterior jsonb not null,
  justificativa text not null,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

alter table public.selos_correcoes_faixa enable row level security;
drop policy if exists selos_correcoes_faixa_admin_select on public.selos_correcoes_faixa;
create policy selos_correcoes_faixa_admin_select on public.selos_correcoes_faixa
  for select to authenticated using (public.is_admin());

do $$
declare
  v_lote public.selos_lotes%rowtype;
  v_lote_corrigido public.selos_lotes%rowtype;
  v_lote_complementar uuid;
  v_total_encontrado integer;
  v_saldo_total_posterior integer;
  v_justificativa constant text :=
    'Correcao cadastral confirmada em 27/10/2026: a faixa fisicamente recebida foi 08027301 a 08030300. ' ||
    'Os envases ja registrados a partir de 08027351 foram preservados sem qualquer renumeracao.';
begin
  select count(*) into v_total_encontrado
  from public.selos_lotes l
  join public.insumos_envase i on i.id=l.insumo_id
  where i.codigo='selo_ipi_aguardente'
    and l.serie='AF'
    and l.numeracao_inicial=8027351
    and l.numeracao_final=8030350
    and l.status<>'cancelado';

  if v_total_encontrado<>1 then
    raise exception 'Correcao AF cancelada: esperado um lote 08027351-08030350, encontrado(s) %',v_total_encontrado;
  end if;

  select l.* into v_lote
  from public.selos_lotes l
  join public.insumos_envase i on i.id=l.insumo_id
  where i.codigo='selo_ipi_aguardente'
    and l.serie='AF'
    and l.numeracao_inicial=8027351
    and l.numeracao_final=8030350
    and l.status<>'cancelado'
  for update of l;

  if v_lote.quantidade_total<>3000 then
    raise exception 'Correcao AF cancelada: o lote deveria possuir 3.000 selos, mas possui %',v_lote.quantidade_total;
  end if;
  if v_lote.quantidade_disponivel<50 then
    raise exception 'Correcao AF cancelada: saldo insuficiente para retirar os 50 numeros finais inexistentes';
  end if;
  if v_lote.proximo_numero<8027351 or v_lote.proximo_numero>8030301 then
    raise exception 'Correcao AF cancelada: proximo numero do lote principal fora da faixa correta (%)',v_lote.proximo_numero;
  end if;
  if exists (
    select 1 from public.selos_faixas_utilizadas f
    where f.lote_selo_id=v_lote.id
      and (f.numeracao_inicial<8027351 or f.numeracao_final>8030300)
  ) then
    raise exception 'Correcao AF cancelada: existe faixa utilizada fora de 08027351-08030300';
  end if;
  if exists (
    select 1 from public.selos_lotes l
    where l.id<>v_lote.id
      and l.insumo_id=v_lote.insumo_id
      and l.serie=v_lote.serie
      and l.status<>'cancelado'
      and int8range(l.numeracao_inicial,l.numeracao_final,'[]') && int8range(8027301,8027350,'[]')
  ) then
    raise exception 'Correcao AF cancelada: a faixa complementar 08027301-08027350 ja conflita com outro lote';
  end if;

  -- A parte principal mantem o ponteiro e todas as faixas utilizadas. Apenas
  -- o limite que nunca foi recebido e o respectivo saldo sao retirados.
  update public.selos_lotes
  set numeracao_final=8030300,
      quantidade_total=2950,
      quantidade_disponivel=quantidade_disponivel-50,
      status=case when quantidade_disponivel-50=0 then 'esgotado' else 'ativo' end,
      observacoes=concat_ws(E'\n',nullif(observacoes,''),v_justificativa)
  where id=v_lote.id;

  -- Os numeros anteriores que ainda estavam fisicamente disponiveis formam
  -- uma faixa propria. Assim podem ser consumidos agora sem reabrir ou alterar
  -- a sequencia ja usada no lote principal.
  insert into public.selos_lotes (
    insumo_id,movimento_entrada_id,data_entrada,guia_numero,guia_data,
    grupo,subgrupo,cor,serie,numeracao_inicial,numeracao_final,
    numeracao_largura,proximo_numero,quantidade_total,quantidade_disponivel,
    status,observacoes,criado_por,criado_em
  ) values (
    v_lote.insumo_id,null,v_lote.data_entrada,v_lote.guia_numero,v_lote.guia_data,
    v_lote.grupo,v_lote.subgrupo,v_lote.cor,v_lote.serie,8027301,8027350,
    v_lote.numeracao_largura,8027301,50,50,
    'ativo','Faixa complementar criada pela correcao cadastral de 27/10/2026. ' ||
    'O primeiro envase pendente deve consumir 08027301 a 08027312.',
    v_lote.criado_por,v_lote.criado_em - interval '1 microsecond'
  ) returning id into v_lote_complementar;

  -- O lancamento de entrada passa a refletir a faixa realmente recebida. A
  -- descricao conserva os valores anteriores para auditoria humana.
  if v_lote.movimento_entrada_id is not null then
    update public.livro_selos_movimentos
    set numeracao_inicial=8027301,
        numeracao_final=8030300,
        numeracao_largura=8,
        observacoes=concat_ws(E'\n',nullif(observacoes,''),
          v_justificativa || ' Cadastro anterior preservado no historico de correcao: 08027351 a 08030350.')
    where id=v_lote.movimento_entrada_id;
  end if;

  select sum(quantidade_disponivel)::integer into v_saldo_total_posterior
  from public.selos_lotes
  where id in (v_lote.id,v_lote_complementar);

  select * into v_lote_corrigido
  from public.selos_lotes
  where id=v_lote.id;

  insert into public.selos_correcoes_faixa (
    lote_original_id,lote_complementar_id,insumo_id,serie,
    faixa_cadastrada_inicial,faixa_cadastrada_final,
    faixa_correta_inicial,faixa_correta_final,
    proximo_numero_preservado,saldo_disponivel_anterior,
    saldo_disponivel_posterior,estado_anterior,estado_posterior,
    justificativa,criado_por
  ) values (
    v_lote.id,v_lote_complementar,v_lote.insumo_id,v_lote.serie,
    8027351,8030350,8027301,8030300,
    v_lote.proximo_numero,v_lote.quantidade_disponivel,
    v_saldo_total_posterior,to_jsonb(v_lote),
    jsonb_build_object(
      'lote_principal',to_jsonb(v_lote_corrigido),
      'lote_complementar',(select to_jsonb(l) from public.selos_lotes l where l.id=v_lote_complementar)
    ),
    v_justificativa,v_lote.criado_por
  );

  if v_saldo_total_posterior<>v_lote.quantidade_disponivel then
    raise exception 'Correcao AF cancelada: o saldo total seria alterado de % para %',
      v_lote.quantidade_disponivel,v_saldo_total_posterior;
  end if;
end $$;

comment on table public.selos_correcoes_faixa is
  'Historico imutavel das correcoes cadastrais de faixas recebidas, sem renumerar envases.';

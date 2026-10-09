-- Os líquidos passam a fazer parte da receita de envase. O saldo é guardado
-- em mililitros para manter precisão de 1 ml usando as colunas inteiras já
-- existentes. A interface converte esse valor para litros.

insert into public.insumos_envase(codigo,nome,produto_bling_id,quantidade)
values
  ('liquido_cachaca_prata','Cachaça Prata disponível',null,0),
  ('liquido_cachaca_ouro','Cachaça Ouro disponível',null,0),
  ('liquido_bebida_mista_ggm','Bebida Mista — Gengibre, Guaco e Mel disponível',null,0)
on conflict (codigo) do update set nome=excluded.nome;

-- A mesma Cachaça Prata abastece as versões de 700 e 750 ml; o mesmo vale
-- para a Cachaça Ouro. Os saldos de Prata, Ouro e Bebida Mista são separados.
insert into public.receitas_envase(
  produto_bling_id,insumo_id,tipo_consumo,quantidade_por_garrafa
)
select receita.produto_id,insumo.id,'por_garrafa',receita.mililitros
from (values
  ('16687078597','liquido_cachaca_prata',700),
  ('16712114193','liquido_cachaca_prata',750),
  ('16699660347','liquido_cachaca_ouro',700),
  ('16712113631','liquido_cachaca_ouro',750),
  ('16699719562','liquido_bebida_mista_ggm',700)
) as receita(produto_id,codigo,mililitros)
join public.insumos_envase insumo on insumo.codigo=receita.codigo
on conflict (produto_bling_id,insumo_id) do update
set tipo_consumo=excluded.tipo_consumo,
    quantidade_por_garrafa=excluded.quantidade_por_garrafa;

-- Mantém o vínculo com o líquido quando uma receita for reconfigurada pela
-- edição de produto no painel.
create or replace function public.configurar_receita_envase(
  p_produto_bling_id text,
  p_produto_nome text,
  p_formato text,
  p_categoria text
)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_codigo_rotulo text;
  v_codigo_selo text;
  v_codigo_liquido text;
  v_volume_ml integer;
  v_codigos text[];
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if trim(coalesce(p_produto_bling_id,''))='' then raise exception 'Produto do Bling nao informado'; end if;
  if p_formato not in ('tradicional_700','quadrada_750') then raise exception 'Formato de garrafa invalido'; end if;
  if p_categoria not in ('prata','ouro','bebida_mista') then raise exception 'Categoria fiscal invalida'; end if;

  v_codigo_rotulo := 'rotulo_' || p_produto_bling_id;
  v_codigo_selo := case when p_categoria='bebida_mista' then 'selo_ipi_bebida_mista' else 'selo_ipi_aguardente' end;
  v_codigo_liquido := case
    when p_categoria='prata' then 'liquido_cachaca_prata'
    when p_categoria='ouro' then 'liquido_cachaca_ouro'
    else 'liquido_bebida_mista_ggm'
  end;
  v_volume_ml := case when p_formato='quadrada_750' then 750 else 700 end;

  insert into public.insumos_envase(codigo,nome,produto_bling_id,quantidade)
  values(v_codigo_rotulo,'Rotulos — ' || trim(p_produto_nome),p_produto_bling_id,0)
  on conflict (codigo) do update set nome=excluded.nome, produto_bling_id=excluded.produto_bling_id;

  if p_formato='quadrada_750' then
    v_codigos := array['garrafa_quadrada_750','rolha_quadrada_750','lacre_quadrado_750',v_codigo_rotulo];
  else
    v_codigos := array[
      'garrafa_700','lacre_700',
      case when p_categoria='prata' then 'tampa_prata' else 'tampa_dourada' end,
      v_codigo_rotulo
    ];
  end if;

  delete from public.receitas_envase where produto_bling_id=p_produto_bling_id;
  insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo,quantidade_por_garrafa)
  select p_produto_bling_id,id,'por_garrafa',1
  from public.insumos_envase where codigo=any(v_codigos);

  insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo,quantidade_por_garrafa)
  select p_produto_bling_id,id,'selos',1
  from public.insumos_envase where codigo=v_codigo_selo;

  insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo,quantidade_por_garrafa)
  select p_produto_bling_id,id,'por_garrafa',v_volume_ml
  from public.insumos_envase where codigo=v_codigo_liquido;
end $$;

grant execute on function public.configurar_receita_envase(text,text,text,text) to authenticated;

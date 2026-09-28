-- Cada produto passa a declarar a sua propria receita de envase. Assim as
-- garrafas tradicionais de 700 ml e as quadradas de 750 ml podem coexistir
-- sem compartilhar por engano garrafa, fechamento, lacre ou rotulo.

update public.insumos_envase
   set codigo='garrafa_700', nome='Garrafas tradicionais 700 ml', atualizado_em=now()
 where codigo='garrafa';

update public.insumos_envase
   set codigo='lacre_700', nome='Lacres — garrafa tradicional 700 ml', atualizado_em=now()
 where codigo='lacre';

insert into public.insumos_envase(codigo,nome,produto_bling_id,quantidade)
values
  ('garrafa_700','Garrafas tradicionais 700 ml',null,0),
  ('lacre_700','Lacres — garrafa tradicional 700 ml',null,0),
  ('garrafa_quadrada_750','Garrafas quadradas 750 ml',null,0),
  ('rolha_quadrada_750','Rolhas — garrafa quadrada 750 ml',null,0),
  ('lacre_quadrado_750','Lacres — garrafa quadrada 750 ml',null,0)
on conflict (codigo) do update set nome=excluded.nome;

create table if not exists public.receitas_envase (
  produto_bling_id text not null,
  insumo_id uuid not null references public.insumos_envase(id) on delete restrict,
  tipo_consumo text not null default 'por_garrafa' check (tipo_consumo in ('por_garrafa','selos')),
  quantidade_por_garrafa integer not null default 1 check (quantidade_por_garrafa > 0),
  criado_em timestamptz not null default now(),
  primary key (produto_bling_id, insumo_id)
);

alter table public.receitas_envase enable row level security;
drop policy if exists "admin receitas envase" on public.receitas_envase;
create policy "admin receitas envase" on public.receitas_envase
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Receitas dos produtos de 700 ml que ja existem.
delete from public.receitas_envase
where produto_bling_id in ('16687078597','16699660347','16699719562');

insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo)
select receita.produto_id, insumo.id, receita.tipo
from (values
  ('16687078597','garrafa_700','por_garrafa'),
  ('16687078597','lacre_700','por_garrafa'),
  ('16687078597','tampa_prata','por_garrafa'),
  ('16687078597','selo_ipi_aguardente','selos'),
  ('16699660347','garrafa_700','por_garrafa'),
  ('16699660347','lacre_700','por_garrafa'),
  ('16699660347','tampa_dourada','por_garrafa'),
  ('16699660347','selo_ipi_aguardente','selos'),
  ('16699719562','garrafa_700','por_garrafa'),
  ('16699719562','lacre_700','por_garrafa'),
  ('16699719562','tampa_dourada','por_garrafa'),
  ('16699719562','selo_ipi_bebida_mista','selos')
) as receita(produto_id,codigo,tipo)
join public.insumos_envase insumo on insumo.codigo=receita.codigo
on conflict do nothing;

insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo)
select insumo.produto_bling_id, insumo.id, 'por_garrafa'
from public.insumos_envase insumo
where insumo.codigo like 'rotulo_%'
  and insumo.produto_bling_id in ('16687078597','16699660347','16699719562')
on conflict do nothing;

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
  v_codigos text[];
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if trim(coalesce(p_produto_bling_id,''))='' then raise exception 'Produto do Bling nao informado'; end if;
  if p_formato not in ('tradicional_700','quadrada_750') then raise exception 'Formato de garrafa invalido'; end if;
  if p_categoria not in ('prata','ouro','bebida_mista') then raise exception 'Categoria fiscal invalida'; end if;

  v_codigo_rotulo := 'rotulo_' || p_produto_bling_id;
  v_codigo_selo := case when p_categoria='bebida_mista' then 'selo_ipi_bebida_mista' else 'selo_ipi_aguardente' end;

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
  insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo)
  select p_produto_bling_id,id,'por_garrafa'
  from public.insumos_envase where codigo=any(v_codigos);

  insert into public.receitas_envase(produto_bling_id,insumo_id,tipo_consumo)
  select p_produto_bling_id,id,'selos'
  from public.insumos_envase where codigo=v_codigo_selo;
end $$;

grant execute on function public.configurar_receita_envase(text,text,text,text) to authenticated;

create or replace function public.registrar_envase(
 p_produto_bling_id text, p_produto_nome text, p_lote text, p_data date,
 p_garrafas integer, p_selos_aplicados integer, p_selos_perdidos integer,
 p_deposito_bling_id text, p_observacoes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_envase uuid;
 v_item record;
 v_consumo integer;
 v_total_itens integer;
begin
 if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
 if p_garrafas <= 0 or p_selos_aplicados < 0 or p_selos_perdidos < 0 then raise exception 'Quantidades invalidas'; end if;
 if trim(coalesce(p_lote,''))='' or trim(coalesce(p_deposito_bling_id,''))='' then raise exception 'Lote e deposito sao obrigatorios'; end if;

 select count(*) into v_total_itens from public.receitas_envase where produto_bling_id=p_produto_bling_id;
 if v_total_itens=0 then raise exception 'Este produto ainda nao possui receita de envase configurada'; end if;

 for v_item in
   select receita.*, insumo.nome, insumo.quantidade
   from public.receitas_envase receita
   join public.insumos_envase insumo on insumo.id=receita.insumo_id
   where receita.produto_bling_id=p_produto_bling_id
   for update of insumo
 loop
   v_consumo := case when v_item.tipo_consumo='selos'
     then p_selos_aplicados+p_selos_perdidos
     else p_garrafas*v_item.quantidade_por_garrafa end;
   if v_item.quantidade < v_consumo then raise exception 'Saldo insuficiente de %', v_item.nome; end if;
 end loop;

 insert into public.envases(produto_bling_id,produto_nome,lote,data_envase,garrafas,selos_aplicados,selos_perdidos,deposito_bling_id,observacoes,criado_por)
 values(p_produto_bling_id,p_produto_nome,trim(p_lote),p_data,p_garrafas,p_selos_aplicados,p_selos_perdidos,p_deposito_bling_id,p_observacoes,auth.uid()) returning id into v_envase;

 for v_item in
   select receita.*, insumo.nome
   from public.receitas_envase receita
   join public.insumos_envase insumo on insumo.id=receita.insumo_id
   where receita.produto_bling_id=p_produto_bling_id
 loop
   v_consumo := case when v_item.tipo_consumo='selos'
     then p_selos_aplicados+p_selos_perdidos
     else p_garrafas*v_item.quantidade_por_garrafa end;
   update public.insumos_envase set quantidade=quantidade-v_consumo, atualizado_em=now() where id=v_item.insumo_id;
   insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
   values(v_item.insumo_id,v_envase,-v_consumo,'Envase lote '||trim(p_lote),auth.uid());
 end loop;
 return v_envase;
end $$;

grant execute on function public.registrar_envase(text,text,text,date,integer,integer,integer,text,text) to authenticated;

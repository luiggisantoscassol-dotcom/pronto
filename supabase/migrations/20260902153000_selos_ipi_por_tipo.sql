-- Separa o controle de selos IPI conforme a classificação da bebida.
update public.insumos_envase
set codigo = 'selo_ipi_aguardente', nome = 'Selos IPI — Aguardente', atualizado_em = now()
where codigo = 'selo_ipi';

insert into public.insumos_envase (codigo, nome, produto_bling_id, quantidade)
values ('selo_ipi_bebida_mista', 'Selos IPI — Bebida Mista', '16699719562', 0)
on conflict (codigo) do nothing;

create or replace function public.registrar_envase(
 p_produto_bling_id text, p_produto_nome text, p_lote text, p_data date,
 p_garrafas integer, p_selos_aplicados integer, p_selos_perdidos integer,
 p_deposito_bling_id text, p_observacoes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_envase uuid; v_item record; v_consumo integer; v_codigo_selo text;
begin
 if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
 if p_produto_bling_id not in ('16687078597','16699660347','16699719562') then raise exception 'Produto inválido'; end if;
 if p_garrafas <= 0 or p_selos_aplicados < 0 or p_selos_perdidos < 0 then raise exception 'Quantidades inválidas'; end if;
 if trim(coalesce(p_lote,''))='' or trim(coalesce(p_deposito_bling_id,''))='' then raise exception 'Lote e depósito são obrigatórios'; end if;

 v_codigo_selo := case when p_produto_bling_id='16699719562' then 'selo_ipi_bebida_mista' else 'selo_ipi_aguardente' end;
 for v_item in select * from public.insumos_envase
   where codigo in (v_codigo_selo,'garrafa','tampa','lacre') or (codigo like 'rotulo_%' and produto_bling_id=p_produto_bling_id)
   for update
 loop
   v_consumo := case when v_item.codigo=v_codigo_selo then p_selos_aplicados+p_selos_perdidos else p_garrafas end;
   if v_item.quantidade < v_consumo then raise exception 'Saldo insuficiente de %', v_item.nome; end if;
 end loop;

 insert into public.envases(produto_bling_id,produto_nome,lote,data_envase,garrafas,selos_aplicados,selos_perdidos,deposito_bling_id,observacoes,criado_por)
 values(p_produto_bling_id,p_produto_nome,trim(p_lote),p_data,p_garrafas,p_selos_aplicados,p_selos_perdidos,p_deposito_bling_id,p_observacoes,auth.uid()) returning id into v_envase;

 for v_item in select * from public.insumos_envase
   where codigo in (v_codigo_selo,'garrafa','tampa','lacre') or (codigo like 'rotulo_%' and produto_bling_id=p_produto_bling_id)
   for update
 loop
   v_consumo := case when v_item.codigo=v_codigo_selo then p_selos_aplicados+p_selos_perdidos else p_garrafas end;
   update public.insumos_envase set quantidade=quantidade-v_consumo, atualizado_em=now() where id=v_item.id;
   insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
   values(v_item.id,v_envase,-v_consumo,'Envase lote '||trim(p_lote),auth.uid());
 end loop;
 return v_envase;
end $$;

grant execute on function public.registrar_envase(text,text,text,date,integer,integer,integer,text,text) to authenticated;

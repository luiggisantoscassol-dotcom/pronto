create or replace function public.estornar_envase(p_envase uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_envase public.envases%rowtype; v_mov record;
begin
 if auth.role() <> 'service_role' and not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
 if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'Informe o motivo do estorno'; end if;
 select * into v_envase from public.envases where id=p_envase for update;
 if not found then raise exception 'Envase não encontrado'; end if;
 if v_envase.estornado_em is not null then raise exception 'Envase já estornado'; end if;
 for v_mov in select insumo_id, -quantidade as devolucao from public.movimentos_insumos_envase where envase_id=p_envase and quantidade < 0
 loop
   update public.insumos_envase set quantidade=quantidade+v_mov.devolucao, atualizado_em=now() where id=v_mov.insumo_id;
   insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
   values(v_mov.insumo_id,p_envase,v_mov.devolucao,'Estorno: '||trim(p_motivo),case when auth.role()='service_role' then null else auth.uid() end);
 end loop;
 update public.envases set estornado_em=now(),estornado_por=case when auth.role()='service_role' then null else auth.uid() end,motivo_estorno=trim(p_motivo),estorno_bling_status=case when bling_status='sincronizado' then 'sincronizado' else null end,estorno_bling_erro=null where id=p_envase;
 return jsonb_build_object('ok',true,'produto_bling_id',v_envase.produto_bling_id,'deposito_bling_id',v_envase.deposito_bling_id,'garrafas',v_envase.garrafas);
end $$;

revoke all on function public.estornar_envase(uuid,text) from public,anon;
grant execute on function public.estornar_envase(uuid,text) to authenticated,service_role;

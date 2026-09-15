alter table public.envases
  add column if not exists estornado_em timestamptz,
  add column if not exists estornado_por uuid references auth.users(id),
  add column if not exists motivo_estorno text,
  add column if not exists estorno_bling_status text check (estorno_bling_status in ('pendente','sincronizado','erro')),
  add column if not exists estorno_bling_erro text;

create or replace function public.editar_dados_envase(p_envase uuid, p_lote text, p_data date, p_observacoes text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
 if trim(coalesce(p_lote,''))='' or p_data is null then raise exception 'Lote e data são obrigatórios'; end if;
 update public.envases set lote=trim(p_lote), data_envase=p_data, observacoes=p_observacoes where id=p_envase and estornado_em is null;
 if not found then raise exception 'Envase não encontrado ou já estornado'; end if;
end $$;

create or replace function public.estornar_envase(p_envase uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_envase public.envases%rowtype; v_mov record;
begin
 if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
 if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'Informe o motivo do estorno'; end if;
 select * into v_envase from public.envases where id=p_envase for update;
 if not found then raise exception 'Envase não encontrado'; end if;
 if v_envase.estornado_em is not null then raise exception 'Envase já estornado'; end if;
 for v_mov in select insumo_id, -quantidade as devolucao from public.movimentos_insumos_envase where envase_id=p_envase and quantidade < 0
 loop
   update public.insumos_envase set quantidade=quantidade+v_mov.devolucao, atualizado_em=now() where id=v_mov.insumo_id;
   insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
   values(v_mov.insumo_id,p_envase,v_mov.devolucao,'Estorno: '||trim(p_motivo),auth.uid());
 end loop;
 update public.envases set estornado_em=now(),estornado_por=auth.uid(),motivo_estorno=trim(p_motivo),estorno_bling_status=case when bling_status='sincronizado' then 'pendente' else null end where id=p_envase;
 return jsonb_build_object('produto_bling_id',v_envase.produto_bling_id,'deposito_bling_id',v_envase.deposito_bling_id,'garrafas',v_envase.garrafas,'precisa_bling',v_envase.bling_status='sincronizado');
end $$;

grant execute on function public.editar_dados_envase(uuid,text,date,text) to authenticated;
grant execute on function public.estornar_envase(uuid,text) to authenticated;

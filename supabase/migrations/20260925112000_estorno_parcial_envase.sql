-- Permite encerrar um lote com estorno parcial quando parte das garrafas ja
-- foi vendida. A quantidade original continua imutavel para fins de auditoria.
alter table public.envases
  add column if not exists garrafas_estornadas integer not null default 0
    check (garrafas_estornadas >= 0 and garrafas_estornadas <= garrafas),
  add column if not exists estorno_tipo text
    check (estorno_tipo is null or estorno_tipo in ('total', 'parcial'));

create or replace function public.estornar_envase_parcial(
  p_envase uuid,
  p_quantidade integer,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_envase public.envases%rowtype;
  v_mov record;
  v_devolucao integer;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'Acesso administrativo necessário';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do estorno';
  end if;

  select * into v_envase from public.envases where id=p_envase for update;
  if not found then raise exception 'Envase não encontrado'; end if;
  if v_envase.estornado_em is not null then raise exception 'Envase já encerrado por estorno'; end if;
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > v_envase.garrafas then
    raise exception 'Quantidade de estorno inválida';
  end if;

  -- Cada movimento negativo representa o consumo original de um insumo. No
  -- estorno parcial, a devolucao acompanha a proporcao de garrafas retirada.
  for v_mov in
    select insumo_id, -quantidade as consumo
      from public.movimentos_insumos_envase
     where envase_id=p_envase and quantidade < 0
  loop
    v_devolucao := case
      when p_quantidade = v_envase.garrafas then v_mov.consumo
      else floor((v_mov.consumo::numeric * p_quantidade) / v_envase.garrafas)::integer
    end;
    if v_devolucao > 0 then
      update public.insumos_envase
         set quantidade=quantidade+v_devolucao, atualizado_em=now()
       where id=v_mov.insumo_id;
      insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
      values(
        v_mov.insumo_id,
        p_envase,
        v_devolucao,
        case when p_quantidade=v_envase.garrafas then 'Estorno total: ' else 'Estorno parcial: ' end || trim(p_motivo),
        case when auth.role()='service_role' then null else auth.uid() end
      );
    end if;
  end loop;

  update public.envases
     set estornado_em=now(),
         estornado_por=case when auth.role()='service_role' then null else auth.uid() end,
         motivo_estorno=trim(p_motivo),
         garrafas_estornadas=p_quantidade,
         estorno_tipo=case when p_quantidade=garrafas then 'total' else 'parcial' end,
         estorno_bling_status=case when bling_status='sincronizado' then 'sincronizado' else null end,
         estorno_bling_erro=null
   where id=p_envase;

  return jsonb_build_object(
    'ok', true,
    'produto_bling_id', v_envase.produto_bling_id,
    'deposito_bling_id', v_envase.deposito_bling_id,
    'garrafas_originais', v_envase.garrafas,
    'garrafas_estornadas', p_quantidade,
    'garrafas_mantidas', v_envase.garrafas-p_quantidade,
    'tipo', case when p_quantidade=v_envase.garrafas then 'total' else 'parcial' end
  );
end
$$;

revoke all on function public.estornar_envase_parcial(uuid,integer,text) from public,anon;
grant execute on function public.estornar_envase_parcial(uuid,integer,text) to authenticated,service_role;

alter table public.embalagem_movimentos
  drop constraint if exists embalagem_movimentos_tipo_check;

alter table public.embalagem_movimentos
  add constraint embalagem_movimentos_tipo_check
  check (tipo in ('ajuste','baixa_etiqueta','baixa_pdv','estorno'));

create unique index if not exists embalagem_movimentos_baixa_pdv_unica
  on public.embalagem_movimentos(pedido_id)
  where tipo = 'baixa_pdv';

create or replace function public.baixar_embalagem_pdv(
  p_pedido_id uuid,
  p_referencia text,
  p_embalagem_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo integer;
  v_nome text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Operação restrita ao servidor';
  end if;
  if exists(select 1 from public.embalagem_movimentos where pedido_id=p_pedido_id and tipo='baixa_pdv') then
    return jsonb_build_object('ok',true,'ja_processado',true);
  end if;
  select estoque,nome into v_saldo,v_nome from public.embalagens where id=p_embalagem_id and ativo for update;
  if not found then raise exception 'Embalagem indisponível'; end if;
  if v_saldo < 1 then raise exception 'Estoque insuficiente da embalagem'; end if;
  update public.embalagens set estoque=estoque-1,atualizado_em=now() where id=p_embalagem_id returning estoque into v_saldo;
  insert into public.embalagem_movimentos(embalagem_id,pedido_id,referencia,tipo,quantidade,saldo_apos,observacao)
  values(p_embalagem_id,p_pedido_id,p_referencia,'baixa_pdv',-1,v_saldo,'Embalagem usada em venda no balcão');
  return jsonb_build_object('ok',true,'ja_processado',false,'nome',v_nome,'saldo',v_saldo);
end;
$$;

revoke all on function public.baixar_embalagem_pdv(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.baixar_embalagem_pdv(uuid,text,uuid) to service_role;

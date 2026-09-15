create or replace function public.estornar_embalagem_pdv(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baixa public.embalagem_movimentos%rowtype;
  v_saldo integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Operação restrita ao servidor'; end if;
  select * into v_baixa from public.embalagem_movimentos
   where pedido_id=p_pedido_id and tipo='baixa_pdv' order by criado_em limit 1 for update;
  if not found then return jsonb_build_object('ok',true,'nao_aplicavel',true); end if;
  if exists(select 1 from public.embalagem_movimentos where pedido_id=p_pedido_id and embalagem_id=v_baixa.embalagem_id and tipo='estorno') then
    return jsonb_build_object('ok',true,'ja_estornado',true);
  end if;
  update public.embalagens set estoque=estoque+abs(v_baixa.quantidade),atualizado_em=now()
   where id=v_baixa.embalagem_id returning estoque into v_saldo;
  insert into public.embalagem_movimentos(embalagem_id,pedido_id,referencia,tipo,quantidade,saldo_apos,observacao)
  values(v_baixa.embalagem_id,p_pedido_id,v_baixa.referencia,'estorno',abs(v_baixa.quantidade),v_saldo,'Estorno de embalagem da venda no balcão');
  return jsonb_build_object('ok',true,'saldo',v_saldo);
end;
$$;

revoke all on function public.estornar_embalagem_pdv(uuid) from public,anon,authenticated;
grant execute on function public.estornar_embalagem_pdv(uuid) to service_role;

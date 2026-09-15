create or replace function public.estornar_movimento_consignacao(p_movimento uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_mov public.consignacao_movimentos%rowtype; v_item record;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  select * into v_mov from public.consignacao_movimentos where id=p_movimento for update;
  if not found or v_mov.status='estornado' then raise exception 'Movimento não encontrado ou já estornado'; end if;
  if v_mov.bling_nfe_id is not null and coalesce(v_mov.bling_nfe_status,'') not in ('2','4') then
    raise exception 'Esta movimentação possui NF-e ativa. Cancele o documento no Bling e confirme o cancelamento no painel antes do estorno';
  end if;
  if trim(coalesce(p_motivo,''))='' then raise exception 'Informe o motivo do estorno'; end if;
  for v_item in select * from public.consignacao_itens where movimento_id=p_movimento loop
    if v_mov.tipo='remessa' then update public.produtos set estoque=estoque+v_item.quantidade where id=v_item.produto_id;
    elsif v_mov.tipo='devolucao' then
      if (select estoque from public.produtos where id=v_item.produto_id for update)<v_item.quantidade then raise exception 'Estoque insuficiente para estornar a devolução de %',v_item.produto_nome; end if;
      update public.produtos set estoque=estoque-v_item.quantidade where id=v_item.produto_id;
    end if;
  end loop;
  update public.consignacao_movimentos set status='estornado',estornado_em=now(),estornado_por=auth.uid(),motivo_estorno=trim(p_motivo) where id=p_movimento;
  return jsonb_build_object('tipo',v_mov.tipo,'deposito_bling_id',v_mov.deposito_bling_id,'bling_estoque_sincronizado',v_mov.bling_estoque_status='sincronizado');
end $$;

grant execute on function public.estornar_movimento_consignacao(uuid,text) to authenticated;

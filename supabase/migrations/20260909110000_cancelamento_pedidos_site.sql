alter table public.pedidos
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid references auth.users(id),
  add column if not exists motivo_cancelamento text,
  add column if not exists estoque_estornado_em timestamptz,
  add column if not exists bling_cancelado_em timestamptz;

create or replace function public.estornar_estoque_pedido_cancelado(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_item jsonb;
  v_produto public.produtos%rowtype;
  v_quantidade integer;
begin
  select * into v_pedido from public.pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.estoque_estornado_em is not null then
    return jsonb_build_object('ok', true, 'ja_estornado', true);
  end if;
  if v_pedido.estoque_reservado_em is null then
    update public.pedidos set estoque_estornado_em = now() where id = p_pedido;
    return jsonb_build_object('ok', true, 'sem_reserva', true);
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_pedido.itens_json, '[]'::jsonb)) order by value->>'id'
  loop
    v_quantidade := greatest(1, coalesce((v_item->>'quantidade')::integer, 1));
    select * into v_produto from public.produtos
      where id::text = v_item->>'id' or bling_id::text = v_item->>'bling_id'
      order by case when id::text = v_item->>'id' then 0 else 1 end limit 1 for update;
    if not found then raise exception 'Produto não encontrado: %', coalesce(v_item->>'nome', 'item'); end if;
    update public.produtos set estoque = coalesce(estoque, 0) + v_quantidade where id = v_produto.id;
  end loop;
  update public.pedidos set estoque_estornado_em = now() where id = p_pedido;
  return jsonb_build_object('ok', true, 'ja_estornado', false);
end;
$$;

revoke all on function public.estornar_estoque_pedido_cancelado(uuid) from public, anon, authenticated;
grant execute on function public.estornar_estoque_pedido_cancelado(uuid) to service_role;

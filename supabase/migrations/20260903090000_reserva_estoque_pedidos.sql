alter table public.pedidos
  add column if not exists estoque_reservado_em timestamptz,
  add column if not exists bling_estoque_lancado_em timestamptz;

create or replace function public.reservar_estoque_pedido(p_referencia text)
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
  select * into v_pedido
  from public.pedidos
  where referencia = p_referencia
  for update;

  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.estoque_reservado_em is not null then
    return jsonb_build_object('ok', true, 'ja_reservado', true);
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_pedido.itens_json, '[]'::jsonb)) order by value->>'id'
  loop
    v_quantidade := greatest(1, coalesce((v_item->>'quantidade')::integer, 1));
    select * into v_produto
    from public.produtos
    where id::text = v_item->>'id'
       or bling_id::text = v_item->>'bling_id'
    order by case when id::text = v_item->>'id' then 0 else 1 end
    limit 1
    for update;

    if not found then raise exception 'Produto não encontrado: %', coalesce(v_item->>'nome', 'item'); end if;
    if coalesce(v_produto.estoque, 0) < v_quantidade then
      raise exception 'Estoque insuficiente para %.', coalesce(v_produto.nome, v_item->>'nome', 'produto');
    end if;
    update public.produtos set estoque = estoque - v_quantidade where id = v_produto.id;
  end loop;

  update public.pedidos set estoque_reservado_em = now() where id = v_pedido.id;
  return jsonb_build_object('ok', true, 'ja_reservado', false);
end;
$$;

revoke all on function public.reservar_estoque_pedido(text) from public, anon, authenticated;
grant execute on function public.reservar_estoque_pedido(text) to service_role;

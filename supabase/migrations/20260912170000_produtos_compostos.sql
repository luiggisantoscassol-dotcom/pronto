alter table public.produtos
  add column if not exists tipo_produto text not null default 'unitario'
    check (tipo_produto in ('unitario','kit')),
  add column if not exists unidades_por_kit integer not null default 1
    check (unidades_por_kit > 0);

create table if not exists public.produto_componentes (
  kit_id uuid not null references public.produtos(id) on delete cascade,
  componente_id uuid not null references public.produtos(id) on delete restrict,
  quantidade integer not null check (quantidade > 0),
  criado_em timestamptz not null default now(),
  primary key (kit_id, componente_id),
  check (kit_id <> componente_id)
);

alter table public.produto_componentes enable row level security;
drop policy if exists produto_componentes_public_read on public.produto_componentes;
create policy produto_componentes_public_read on public.produto_componentes for select using (true);
drop policy if exists produto_componentes_admin_all on public.produto_componentes;
create policy produto_componentes_admin_all on public.produto_componentes for all
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.recalcular_estoque_kit(p_kit uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_saldo integer;
begin
  select coalesce(min(floor(coalesce(p.estoque,0)::numeric / pc.quantidade)),0)::integer
    into v_saldo
  from public.produto_componentes pc
  join public.produtos p on p.id=pc.componente_id
  where pc.kit_id=p_kit;
  update public.produtos
    set estoque=v_saldo,
        unidades_por_kit=coalesce((select sum(quantidade) from public.produto_componentes where kit_id=p_kit),1)
  where id=p_kit and tipo_produto='kit';
  return v_saldo;
end; $$;

create or replace function public.recalcular_kits_do_componente()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_kit uuid;
begin
  if new.tipo_produto <> 'unitario' or new.estoque is not distinct from old.estoque then return new; end if;
  for v_kit in select kit_id from public.produto_componentes where componente_id=new.id
  loop perform public.recalcular_estoque_kit(v_kit); end loop;
  return new;
end; $$;

drop trigger if exists produtos_recalcular_kits on public.produtos;
create trigger produtos_recalcular_kits after update of estoque on public.produtos
for each row execute function public.recalcular_kits_do_componente();

create or replace function public.recalcular_kit_apos_componente()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    perform public.recalcular_estoque_kit(old.kit_id);
    return old;
  end if;
  perform public.recalcular_estoque_kit(new.kit_id);
  if tg_op='UPDATE' and old.kit_id<>new.kit_id then perform public.recalcular_estoque_kit(old.kit_id); end if;
  return new;
end; $$;

drop trigger if exists produto_componentes_recalcular on public.produto_componentes;
create trigger produto_componentes_recalcular after insert or update or delete on public.produto_componentes
for each row execute function public.recalcular_kit_apos_componente();

create or replace function public.reservar_estoque_pedido(p_referencia text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pedido public.pedidos%rowtype; v_linha record; v_produto public.produtos%rowtype;
begin
  select * into v_pedido from public.pedidos where referencia=p_referencia for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.estoque_reservado_em is not null then return jsonb_build_object('ok',true,'ja_reservado',true); end if;
  for v_linha in
    with itens as (select value item from jsonb_array_elements(coalesce(v_pedido.itens_json,'[]'::jsonb))),
    baixas as (
      select coalesce(c->>'id',item->>'id') produto_id,
             greatest(1,coalesce((item->>'quantidade')::integer,1))*greatest(1,coalesce((c->>'quantidade')::integer,1)) quantidade
      from itens left join lateral jsonb_array_elements(case when jsonb_typeof(item->'componentes')='array' and jsonb_array_length(item->'componentes')>0 then item->'componentes' else jsonb_build_array(jsonb_build_object('id',item->>'id','quantidade',1)) end) c on true)
    select produto_id,sum(quantidade)::integer quantidade from baixas group by produto_id order by produto_id
  loop
    select * into v_produto from public.produtos where id::text=v_linha.produto_id for update;
    if not found then raise exception 'Componente do produto não encontrado.'; end if;
    if coalesce(v_produto.estoque,0)<v_linha.quantidade then raise exception 'Estoque insuficiente para %.',v_produto.nome; end if;
    update public.produtos set estoque=estoque-v_linha.quantidade where id=v_produto.id;
  end loop;
  update public.pedidos set estoque_reservado_em=now() where id=v_pedido.id;
  return jsonb_build_object('ok',true,'ja_reservado',false);
end; $$;

create or replace function public.estornar_estoque_pedido_cancelado(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pedido public.pedidos%rowtype; v_linha record;
begin
  select * into v_pedido from public.pedidos where id=p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.estoque_estornado_em is not null then return jsonb_build_object('ok',true,'ja_estornado',true); end if;
  if v_pedido.estoque_reservado_em is null then update public.pedidos set estoque_estornado_em=now() where id=p_pedido; return jsonb_build_object('ok',true,'sem_reserva',true); end if;
  for v_linha in
    with itens as (select value item from jsonb_array_elements(coalesce(v_pedido.itens_json,'[]'::jsonb))),
    devolucoes as (
      select coalesce(c->>'id',item->>'id') produto_id,
             greatest(1,coalesce((item->>'quantidade')::integer,1))*greatest(1,coalesce((c->>'quantidade')::integer,1)) quantidade
      from itens left join lateral jsonb_array_elements(case when jsonb_typeof(item->'componentes')='array' and jsonb_array_length(item->'componentes')>0 then item->'componentes' else jsonb_build_array(jsonb_build_object('id',item->>'id','quantidade',1)) end) c on true)
    select produto_id,sum(quantidade)::integer quantidade from devolucoes group by produto_id order by produto_id
  loop
    update public.produtos set estoque=coalesce(estoque,0)+v_linha.quantidade where id::text=v_linha.produto_id;
    if not found then raise exception 'Componente do produto não encontrado.'; end if;
  end loop;
  update public.pedidos set estoque_estornado_em=now() where id=p_pedido;
  return jsonb_build_object('ok',true,'ja_estornado',false);
end; $$;

revoke all on function public.recalcular_estoque_kit(uuid) from public,anon,authenticated;
grant execute on function public.recalcular_estoque_kit(uuid) to service_role;
revoke all on function public.reservar_estoque_pedido(text) from public,anon,authenticated;
grant execute on function public.reservar_estoque_pedido(text) to service_role;
revoke all on function public.estornar_estoque_pedido_cancelado(uuid) from public,anon,authenticated;
grant execute on function public.estornar_estoque_pedido_cancelado(uuid) to service_role;

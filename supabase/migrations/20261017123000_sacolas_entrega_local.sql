alter table public.pedidos
  add column if not exists sacolas_reservadas_em timestamptz,
  add column if not exists sacolas_estornadas_em timestamptz;

alter table public.embalagem_movimentos
  drop constraint if exists embalagem_movimentos_tipo_check;
alter table public.embalagem_movimentos
  add constraint embalagem_movimentos_tipo_check
  check (tipo in ('ajuste','baixa_etiqueta','estorno','baixa_pdv','reserva_sacola','estorno_sacola'));

drop policy if exists embalagens_sacolas_public_read on public.embalagens;
create policy embalagens_sacolas_public_read on public.embalagens
for select to anon, authenticated
using (ativo and upper(coalesce(especie,''))='SACOLA');

insert into public.embalagens
  (nome,capacidade_garrafas,estoque,altura_cm,largura_cm,comprimento_cm,peso_vazio_kg,especie,marca,numeracao,ativo)
select 'Sacola simples',1,0,1,1,1,0,'SACOLA','TIO NAN','SIMPLES',true
where not exists(select 1 from public.embalagens where upper(coalesce(especie,''))='SACOLA' and capacidade_garrafas=1);

insert into public.embalagens
  (nome,capacidade_garrafas,estoque,altura_cm,largura_cm,comprimento_cm,peso_vazio_kg,especie,marca,numeracao,ativo)
select 'Sacola dupla',2,0,1,1,1,0,'SACOLA','TIO NAN','DUPLA',true
where not exists(select 1 from public.embalagens where upper(coalesce(especie,''))='SACOLA' and capacidade_garrafas=2);

create or replace function public.validar_e_reservar_sacolas(p_pedido_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_pedido public.pedidos%rowtype;
  v_item jsonb;
  v_emb public.embalagens%rowtype;
  v_qtd integer;
  v_capacidade integer := 0;
  v_total_garrafas integer := 0;
  v_duplas integer := 0;
  v_simples integer := 0;
  v_origem text;
begin
  select * into v_pedido from public.pedidos where id=p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_pedido.sacolas_reservadas_em is not null then return jsonb_build_object('ok',true,'ja_reservado',true); end if;
  if jsonb_typeof(coalesce(v_pedido.frete_detalhes->'sacolas','[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(v_pedido.frete_detalhes->'sacolas','[]'::jsonb))=0 then
    return jsonb_build_object('ok',true,'sem_sacolas',true);
  end if;

  v_origem := lower(coalesce(v_pedido.frete_detalhes->>'origem',''));
  if v_origem not in ('retirada','entrega_local','pdv') then raise exception 'Sacolas disponíveis somente para retirada, balcão ou entrega local em Porto Alegre.'; end if;
  if v_origem='entrega_local' and lower(coalesce(v_pedido.endereco,'')) not like '%porto alegre%' then
    raise exception 'Sacolas disponíveis somente para entrega local em Porto Alegre.';
  end if;

  select coalesce(sum(greatest(1,coalesce((item->>'quantidade')::integer,1))*greatest(1,coalesce((item->>'unidades_por_kit')::integer,1))),0)::integer
    into v_total_garrafas
  from jsonb_array_elements(coalesce(v_pedido.itens_json,'[]'::jsonb)) item;

  for v_item in select value from jsonb_array_elements(v_pedido.frete_detalhes->'sacolas') loop
    v_qtd := greatest(1,coalesce((v_item->>'quantidade')::integer,1));
    select * into v_emb from public.embalagens
      where id::text=v_item->>'id' and ativo and upper(coalesce(especie,''))='SACOLA' for update;
    if not found then raise exception 'Modelo de sacola indisponível.'; end if;
    if v_emb.capacidade_garrafas not in (1,2) then raise exception 'Capacidade de sacola inválida.'; end if;
    if v_emb.estoque<v_qtd then raise exception 'Estoque insuficiente de %.',v_emb.nome; end if;
    v_capacidade := v_capacidade + v_emb.capacidade_garrafas*v_qtd;
    if v_emb.capacidade_garrafas=2 then v_duplas:=v_duplas+v_qtd; else v_simples:=v_simples+v_qtd; end if;
  end loop;

  if v_capacidade<>v_total_garrafas or v_duplas<>floor(v_total_garrafas/2.0)::integer or v_simples<>mod(v_total_garrafas,2) then
    raise exception 'A combinação de sacolas não corresponde à quantidade de garrafas.';
  end if;

  for v_item in select value from jsonb_array_elements(v_pedido.frete_detalhes->'sacolas') loop
    v_qtd := greatest(1,coalesce((v_item->>'quantidade')::integer,1));
    update public.embalagens set estoque=estoque-v_qtd,atualizado_em=now()
      where id::text=v_item->>'id' returning * into v_emb;
    insert into public.embalagem_movimentos(embalagem_id,pedido_id,referencia,tipo,quantidade,saldo_apos,observacao)
    values(v_emb.id,v_pedido.id,v_pedido.referencia,'reserva_sacola',-v_qtd,v_emb.estoque,'Sacola gratuita para retirada, balcão ou entrega local');
  end loop;
  update public.pedidos set sacolas_reservadas_em=now() where id=v_pedido.id;
  return jsonb_build_object('ok',true,'ja_reservado',false);
end $$;

create or replace function public.reservar_sacolas_pedido(p_pedido_id uuid,p_sacolas jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_estoque_reservado_em timestamptz;
begin
  if auth.role()<>'service_role' and not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  update public.pedidos
    set frete_detalhes=coalesce(frete_detalhes,'{}'::jsonb)||jsonb_build_object('origem','pdv','sacolas',coalesce(p_sacolas,'[]'::jsonb))
    where id=p_pedido_id
    returning estoque_reservado_em into v_estoque_reservado_em;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_estoque_reservado_em is null then
    return jsonb_build_object('ok',true,'pendente',true);
  end if;
  return public.validar_e_reservar_sacolas(p_pedido_id);
end $$;

create or replace function public.reservar_sacolas_apos_estoque()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.estoque_reservado_em is null and new.estoque_reservado_em is not null then
    perform public.validar_e_reservar_sacolas(new.id);
  end if;
  return new;
end $$;
drop trigger if exists pedidos_reservar_sacolas on public.pedidos;
create trigger pedidos_reservar_sacolas after update of estoque_reservado_em on public.pedidos
for each row execute function public.reservar_sacolas_apos_estoque();

create or replace function public.estornar_sacolas_apos_estoque()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item jsonb; v_qtd integer; v_emb public.embalagens%rowtype;
begin
  if old.estoque_estornado_em is null and new.estoque_estornado_em is not null
     and new.sacolas_reservadas_em is not null and new.sacolas_estornadas_em is null then
    for v_item in select value from jsonb_array_elements(coalesce(new.frete_detalhes->'sacolas','[]'::jsonb)) loop
      v_qtd:=greatest(1,coalesce((v_item->>'quantidade')::integer,1));
      update public.embalagens set estoque=estoque+v_qtd,atualizado_em=now()
        where id::text=v_item->>'id' returning * into v_emb;
      if found then
        insert into public.embalagem_movimentos(embalagem_id,pedido_id,referencia,tipo,quantidade,saldo_apos,observacao)
        values(v_emb.id,new.id,new.referencia,'estorno_sacola',v_qtd,v_emb.estoque,'Estorno automático das sacolas do pedido cancelado');
      end if;
    end loop;
    update public.pedidos set sacolas_estornadas_em=now() where id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists pedidos_estornar_sacolas on public.pedidos;
create trigger pedidos_estornar_sacolas after update of estoque_estornado_em on public.pedidos
for each row execute function public.estornar_sacolas_apos_estoque();

revoke all on function public.validar_e_reservar_sacolas(uuid) from public,anon,authenticated;
revoke all on function public.reservar_sacolas_pedido(uuid,jsonb) from public,anon;
grant execute on function public.validar_e_reservar_sacolas(uuid) to service_role;
grant execute on function public.reservar_sacolas_pedido(uuid,jsonb) to authenticated,service_role;

create table if not exists public.embalagens (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  capacidade_garrafas integer not null check (capacidade_garrafas > 0),
  estoque integer not null default 0 check (estoque >= 0),
  altura_cm numeric(10,2) not null check (altura_cm > 0),
  largura_cm numeric(10,2) not null check (largura_cm > 0),
  comprimento_cm numeric(10,2) not null check (comprimento_cm > 0),
  peso_vazio_kg numeric(10,3) not null default 0 check (peso_vazio_kg >= 0),
  especie text not null default 'Caixa',
  marca text not null default 'Tio Nan',
  numeracao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.embalagem_movimentos (
  id uuid primary key default gen_random_uuid(),
  embalagem_id uuid not null references public.embalagens(id),
  pedido_id uuid,
  referencia text,
  tipo text not null check (tipo in ('ajuste','baixa_etiqueta','estorno')),
  quantidade integer not null,
  saldo_apos integer not null,
  observacao text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create table if not exists public.embalagem_baixas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique,
  referencia text not null,
  melhor_envio_order_id text not null unique,
  quantidade_garrafas integer not null check (quantidade_garrafas > 0),
  itens jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);

alter table public.embalagens enable row level security;
alter table public.embalagem_movimentos enable row level security;
alter table public.embalagem_baixas enable row level security;

create or replace function public.registrar_saldo_inicial_embalagem()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.estoque > 0 then
    insert into public.embalagem_movimentos(embalagem_id,tipo,quantidade,saldo_apos,observacao,criado_por)
    values(new.id,'ajuste',new.estoque,new.estoque,'Saldo inicial do modelo de caixa',auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists embalagem_saldo_inicial on public.embalagens;
create trigger embalagem_saldo_inicial after insert on public.embalagens
for each row execute function public.registrar_saldo_inicial_embalagem();

drop policy if exists embalagens_admin_select on public.embalagens;
create policy embalagens_admin_select on public.embalagens for select using (public.is_admin());
drop policy if exists embalagens_admin_write on public.embalagens;
create policy embalagens_admin_write on public.embalagens for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists embalagem_movimentos_admin_select on public.embalagem_movimentos;
create policy embalagem_movimentos_admin_select on public.embalagem_movimentos for select using (public.is_admin());
drop policy if exists embalagem_baixas_admin_select on public.embalagem_baixas;
create policy embalagem_baixas_admin_select on public.embalagem_baixas for select using (public.is_admin());

create or replace function public.ajustar_estoque_embalagem(p_embalagem_id uuid, p_novo_saldo integer, p_observacao text default null)
returns public.embalagens language plpgsql security definer set search_path = public as $$
declare v_atual integer; v_result public.embalagens;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if p_novo_saldo < 0 then raise exception 'O saldo não pode ser negativo'; end if;
  select estoque into v_atual from public.embalagens where id=p_embalagem_id for update;
  if not found then raise exception 'Embalagem não encontrada'; end if;
  update public.embalagens set estoque=p_novo_saldo, atualizado_em=now() where id=p_embalagem_id returning * into v_result;
  insert into public.embalagem_movimentos(embalagem_id,tipo,quantidade,saldo_apos,observacao,criado_por)
  values(p_embalagem_id,'ajuste',p_novo_saldo-v_atual,p_novo_saldo,p_observacao,auth.uid());
  return v_result;
end $$;

create or replace function public.baixar_estoque_embalagens(
  p_pedido_id uuid, p_referencia text, p_melhor_envio_order_id text,
  p_quantidade_garrafas integer, p_itens jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item jsonb; v_id uuid; v_qtd integer; v_saldo integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Operação restrita ao servidor'; end if;
  if exists(select 1 from public.embalagem_baixas where pedido_id=p_pedido_id or melhor_envio_order_id=p_melhor_envio_order_id) then
    return jsonb_build_object('ok',true,'ja_processado',true);
  end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_id := (v_item->>'embalagem_id')::uuid; v_qtd := (v_item->>'quantidade')::integer;
    select estoque into v_saldo from public.embalagens where id=v_id and ativo for update;
    if not found then raise exception 'Embalagem indisponível'; end if;
    if v_saldo < v_qtd then raise exception 'Estoque insuficiente da embalagem'; end if;
    update public.embalagens set estoque=estoque-v_qtd, atualizado_em=now() where id=v_id returning estoque into v_saldo;
    insert into public.embalagem_movimentos(embalagem_id,pedido_id,referencia,tipo,quantidade,saldo_apos,observacao)
    values(v_id,p_pedido_id,p_referencia,'baixa_etiqueta',-v_qtd,v_saldo,'Baixa automática ao gerar etiqueta do Melhor Envio');
  end loop;
  insert into public.embalagem_baixas(pedido_id,referencia,melhor_envio_order_id,quantidade_garrafas,itens)
  values(p_pedido_id,p_referencia,p_melhor_envio_order_id,p_quantidade_garrafas,p_itens);
  return jsonb_build_object('ok',true,'ja_processado',false);
end $$;

revoke all on function public.baixar_estoque_embalagens(uuid,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.baixar_estoque_embalagens(uuid,text,text,integer,jsonb) to service_role;
grant execute on function public.ajustar_estoque_embalagem(uuid,integer,text) to authenticated;

-- Controle de insumos e lotes de envase. Somente administradores acessam.
create table if not exists public.insumos_envase (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  produto_bling_id text,
  quantidade integer not null default 0 check (quantidade >= 0),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.envases (
  id uuid primary key default gen_random_uuid(),
  produto_bling_id text not null,
  produto_nome text not null,
  lote text not null,
  data_envase date not null,
  garrafas integer not null check (garrafas > 0),
  selos_aplicados integer not null check (selos_aplicados >= 0),
  selos_perdidos integer not null default 0 check (selos_perdidos >= 0),
  observacoes text,
  deposito_bling_id text not null,
  bling_status text not null default 'pendente' check (bling_status in ('pendente','sincronizado','erro')),
  bling_erro text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create table if not exists public.movimentos_insumos_envase (
  id bigint generated always as identity primary key,
  insumo_id uuid not null references public.insumos_envase(id),
  envase_id uuid references public.envases(id),
  quantidade integer not null,
  motivo text not null,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

insert into public.insumos_envase (codigo,nome,produto_bling_id) values
 ('selo_ipi','Selos IPI',null), ('garrafa','Garrafas 700 ml',null),
 ('tampa','Tampas',null), ('lacre','Lacres',null),
 ('rotulo_prata','Rótulos — Cachaça Prata','16687078597'),
 ('rotulo_ouro','Rótulos — Cachaça Ouro','16699660347'),
 ('rotulo_ggm','Rótulos — Gengibre, Guaco e Mel','16699719562')
on conflict (codigo) do nothing;

alter table public.insumos_envase enable row level security;
alter table public.envases enable row level security;
alter table public.movimentos_insumos_envase enable row level security;

create policy "admin insumos" on public.insumos_envase for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin envases" on public.envases for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin movimentos envase" on public.movimentos_insumos_envase for select to authenticated using (public.is_admin());

create or replace function public.ajustar_insumo_envase(p_insumo uuid, p_quantidade integer, p_motivo text default 'Ajuste manual')
returns void language plpgsql security definer set search_path=public as $$
declare v_anterior integer;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if p_quantidade < 0 then raise exception 'Quantidade inválida'; end if;
  select quantidade into v_anterior from public.insumos_envase where id=p_insumo for update;
  if not found then raise exception 'Insumo não encontrado'; end if;
  update public.insumos_envase set quantidade=p_quantidade, atualizado_em=now() where id=p_insumo;
  insert into public.movimentos_insumos_envase(insumo_id,quantidade,motivo,criado_por)
  values(p_insumo,p_quantidade-v_anterior,coalesce(nullif(trim(p_motivo),''),'Ajuste manual'),auth.uid());
end $$;

create or replace function public.registrar_envase(
 p_produto_bling_id text, p_produto_nome text, p_lote text, p_data date,
 p_garrafas integer, p_selos_aplicados integer, p_selos_perdidos integer,
 p_deposito_bling_id text, p_observacoes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_envase uuid; v_item record; v_consumo integer;
begin
 if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
 if p_produto_bling_id not in ('16687078597','16699660347','16699719562') then raise exception 'Produto inválido'; end if;
 if p_garrafas <= 0 or p_selos_aplicados < 0 or p_selos_perdidos < 0 then raise exception 'Quantidades inválidas'; end if;
 if trim(coalesce(p_lote,''))='' or trim(coalesce(p_deposito_bling_id,''))='' then raise exception 'Lote e depósito são obrigatórios'; end if;
 for v_item in select * from public.insumos_envase
   where codigo in ('selo_ipi','garrafa','tampa','lacre') or (codigo like 'rotulo_%' and produto_bling_id=p_produto_bling_id)
   for update
 loop
   v_consumo := case when v_item.codigo='selo_ipi' then p_selos_aplicados+p_selos_perdidos else p_garrafas end;
   if v_item.quantidade < v_consumo then raise exception 'Saldo insuficiente de %', v_item.nome; end if;
 end loop;
 insert into public.envases(produto_bling_id,produto_nome,lote,data_envase,garrafas,selos_aplicados,selos_perdidos,deposito_bling_id,observacoes,criado_por)
 values(p_produto_bling_id,p_produto_nome,trim(p_lote),p_data,p_garrafas,p_selos_aplicados,p_selos_perdidos,p_deposito_bling_id,p_observacoes,auth.uid()) returning id into v_envase;
 for v_item in select * from public.insumos_envase
   where codigo in ('selo_ipi','garrafa','tampa','lacre') or (codigo like 'rotulo_%' and produto_bling_id=p_produto_bling_id)
   for update
 loop
   v_consumo := case when v_item.codigo='selo_ipi' then p_selos_aplicados+p_selos_perdidos else p_garrafas end;
   update public.insumos_envase set quantidade=quantidade-v_consumo, atualizado_em=now() where id=v_item.id;
   insert into public.movimentos_insumos_envase(insumo_id,envase_id,quantidade,motivo,criado_por)
   values(v_item.id,v_envase,-v_consumo,'Envase lote '||trim(p_lote),auth.uid());
 end loop;
 return v_envase;
end $$;

grant execute on function public.ajustar_insumo_envase(uuid,integer,text) to authenticated;
grant execute on function public.registrar_envase(text,text,text,date,integer,integer,integer,text,text) to authenticated;

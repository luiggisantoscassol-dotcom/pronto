-- Endurece o acesso aos dados de consignacao e registra toda alteracao relevante.

do $$
declare v_tabela text; v_politica record;
begin
  foreach v_tabela in array array[
    'consignacao_empresas','consignacao_movimentos','consignacao_itens',
    'consignacao_acertos','consignacao_alocacoes','consignacao_pagamentos'
  ] loop
    if to_regclass('public.' || v_tabela) is null then continue; end if;
    execute format('alter table public.%I enable row level security',v_tabela);
    execute format('alter table public.%I force row level security',v_tabela);
    for v_politica in select policyname from pg_policies where schemaname='public' and tablename=v_tabela loop
      execute format('drop policy if exists %I on public.%I',v_politica.policyname,v_tabela);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())','admin leitura ' || v_tabela,v_tabela);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_tabela);
    execute format('grant select on table public.%I to authenticated',v_tabela);
  end loop;
end $$;

-- O cadastro da empresa e editado diretamente pelo painel; todo o restante so muda por RPC segura.
alter table public.consignacao_empresas alter column criado_por set default auth.uid();
create policy "admin cadastro empresas consignacao" on public.consignacao_empresas
  for insert to authenticated with check (public.is_admin() and criado_por=auth.uid());
create policy "admin atualiza empresas consignacao" on public.consignacao_empresas
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert,update on public.consignacao_empresas to authenticated;

revoke all on public.consignacao_saldos from public,anon,authenticated;
grant select on public.consignacao_saldos to authenticated;

-- Retira a execucao publica implicita de todas as funcoes do modulo.
do $$
declare v_func record;
begin
  for v_func in
    select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) argumentos
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (
      p.proname like '%consignacao%' or
      p.proname in ('registrar_movimento_consignacao','estornar_movimento_consignacao')
    )
  loop
    execute format('revoke all on function %I.%I(%s) from public,anon',v_func.nspname,v_func.proname,v_func.argumentos);
    execute format('grant execute on function %I.%I(%s) to authenticated',v_func.nspname,v_func.proname,v_func.argumentos);
  end loop;
end $$;

-- Garante que o atalho legado de recebimento tambem valide o administrador.
create or replace function public.marcar_acerto_consignacao_recebido(p_acerto uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessario'; end if;
  if not exists(select 1 from public.consignacao_acertos where id=p_acerto and status_pagamento not in ('sem_venda','estornado') for update) then
    raise exception 'Acerto inexistente ou sem valor a receber';
  end if;
  update public.consignacao_acertos set status_pagamento='recebido',recebido_em=now() where id=p_acerto;
end $$;
revoke all on function public.marcar_acerto_consignacao_recebido(uuid) from public,anon;
grant execute on function public.marcar_acerto_consignacao_recebido(uuid) to authenticated;

-- Trilha imutavel para identificar quem alterou cada registro e recuperar o estado anterior.
create table if not exists public.consignacao_auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text,
  operacao text not null check (operacao in ('INSERT','UPDATE','DELETE')),
  dados_anteriores jsonb,
  dados_novos jsonb,
  usuario_id uuid,
  ocorrido_em timestamptz not null default now()
);
create index if not exists consignacao_auditoria_registro_idx on public.consignacao_auditoria(tabela,registro_id,ocorrido_em desc);
alter table public.consignacao_auditoria enable row level security;
alter table public.consignacao_auditoria force row level security;
drop policy if exists "admin leitura auditoria consignacao" on public.consignacao_auditoria;
create policy "admin leitura auditoria consignacao" on public.consignacao_auditoria
  for select to authenticated using (public.is_admin());
revoke all on public.consignacao_auditoria from public,anon,authenticated;
grant select on public.consignacao_auditoria to authenticated;

create or replace function public.auditar_consignacao()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_antigo jsonb; v_novo jsonb; v_id text;
begin
  if tg_op='INSERT' then v_novo:=to_jsonb(new); v_id:=v_novo->>'id';
  elsif tg_op='UPDATE' then v_antigo:=to_jsonb(old); v_novo:=to_jsonb(new); v_id:=coalesce(v_novo->>'id',v_antigo->>'id');
  else v_antigo:=to_jsonb(old); v_id:=v_antigo->>'id'; end if;
  insert into public.consignacao_auditoria(tabela,registro_id,operacao,dados_anteriores,dados_novos,usuario_id)
  values(tg_table_name,v_id,tg_op,v_antigo,v_novo,auth.uid());
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.auditar_consignacao() from public,anon,authenticated;

do $$
declare v_tabela text;
begin
  foreach v_tabela in array array[
    'consignacao_empresas','consignacao_movimentos','consignacao_itens',
    'consignacao_acertos','consignacao_alocacoes','consignacao_pagamentos'
  ] loop
    if to_regclass('public.' || v_tabela) is null then continue; end if;
    execute format('drop trigger if exists consignacao_auditoria_trigger on public.%I',v_tabela);
    execute format('create trigger consignacao_auditoria_trigger after insert or update or delete on public.%I for each row execute function public.auditar_consignacao()',v_tabela);
  end loop;
end $$;

comment on table public.consignacao_auditoria is 'Trilha administrativa imutavel das alteracoes feitas no modulo de consignacao.';

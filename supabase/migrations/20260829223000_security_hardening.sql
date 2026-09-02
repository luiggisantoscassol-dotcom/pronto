-- Restringe dados pessoais e operações administrativas.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

-- O projeto possui um único usuário confirmado; ele passa a ser o administrador inicial.
insert into public.admin_users (user_id)
select id from auth.users where email_confirmed_at is not null
on conflict (user_id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

do $$
declare
  target_table text;
  policy_record record;
begin
  foreach target_table in array array['clientes','pedidos','produtos','rastreio_carrinho','avaliacoes']
  loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, target_table);
    end loop;
  end loop;
end $$;

-- Clientes e pedidos: somente o administrador no navegador; Edge Functions usam service_role.
create policy clientes_admin_only on public.clientes
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy pedidos_admin_only on public.pedidos
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Catálogo: leitura pública, escrita somente administrativa.
create policy produtos_public_read on public.produtos
for select to anon, authenticated
using (true);

create policy produtos_admin_write on public.produtos
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Telemetria: visitante pode inserir, mas nunca listar, alterar ou excluir.
create policy rastreio_public_insert on public.rastreio_carrinho
for insert to anon, authenticated
with check (true);

create policy rastreio_admin_all on public.rastreio_carrinho
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Avaliações: leitura e envio públicos; moderação somente administrativa.
create policy avaliacoes_public_read on public.avaliacoes
for select to anon, authenticated
using (true);

create policy avaliacoes_public_insert on public.avaliacoes
for insert to anon, authenticated
with check (true);

create policy avaliacoes_admin_all on public.avaliacoes
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

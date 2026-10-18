create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  device_label text,
  ativo boolean not null default true,
  ultimo_teste_em timestamptz,
  ultimo_envio_em timestamptz,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.admin_push_subscriptions enable row level security;
drop policy if exists admin_push_subscriptions_admin_select on public.admin_push_subscriptions;
create policy admin_push_subscriptions_admin_select on public.admin_push_subscriptions
for select to authenticated using (public.is_admin() and user_id=auth.uid());
drop policy if exists admin_push_subscriptions_admin_insert on public.admin_push_subscriptions;
create policy admin_push_subscriptions_admin_insert on public.admin_push_subscriptions
for insert to authenticated with check (public.is_admin() and user_id=auth.uid());
drop policy if exists admin_push_subscriptions_admin_update on public.admin_push_subscriptions;
create policy admin_push_subscriptions_admin_update on public.admin_push_subscriptions
for update to authenticated using (public.is_admin() and user_id=auth.uid()) with check (public.is_admin() and user_id=auth.uid());
drop policy if exists admin_push_subscriptions_admin_delete on public.admin_push_subscriptions;
create policy admin_push_subscriptions_admin_delete on public.admin_push_subscriptions
for delete to authenticated using (public.is_admin() and user_id=auth.uid());

create index if not exists admin_push_subscriptions_ativas_idx
on public.admin_push_subscriptions(ativo, user_id);

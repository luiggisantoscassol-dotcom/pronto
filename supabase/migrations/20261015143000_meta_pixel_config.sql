create table if not exists public.site_configuracoes (
  chave text primary key,
  valor text not null default '',
  descricao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);

alter table public.site_configuracoes enable row level security;

drop policy if exists site_configuracoes_pixel_public_read on public.site_configuracoes;
create policy site_configuracoes_pixel_public_read
  on public.site_configuracoes
  for select
  using (chave = 'meta_pixel_id' or public.is_admin());

drop policy if exists site_configuracoes_admin_write on public.site_configuracoes;
create policy site_configuracoes_admin_write
  on public.site_configuracoes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.site_configuracoes (chave, valor, descricao)
values ('meta_pixel_id', '1103618278174331', 'ID do Pixel da Meta usado no site')
on conflict (chave) do nothing;

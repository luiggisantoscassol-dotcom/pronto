create table if not exists public.banners_site (
  id uuid primary key default gen_random_uuid(), titulo text not null,
  imagem_desktop_url text not null, imagem_desktop_path text,
  imagem_mobile_url text not null, imagem_mobile_path text,
  link_url text not null default 'todos-produtos.html', texto_alternativo text not null default '',
  ativo boolean not null default true, ordem integer not null default 0,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);
alter table public.banners_site enable row level security;
drop policy if exists banners_site_public_read on public.banners_site;
create policy banners_site_public_read on public.banners_site for select using (ativo = true or public.is_admin());
drop policy if exists banners_site_admin_write on public.banners_site;
create policy banners_site_admin_write on public.banners_site for all to authenticated using (public.is_admin()) with check (public.is_admin());
create index if not exists banners_site_ativos_ordem_idx on public.banners_site (ativo, ordem, criado_em);

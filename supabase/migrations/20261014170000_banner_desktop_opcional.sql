alter table public.banners_site
  alter column imagem_desktop_url drop not null;

alter table public.banners_site
  drop constraint if exists banners_site_tem_imagem_mobile;

alter table public.banners_site
  add constraint banners_site_tem_imagem_mobile
  check (nullif(btrim(imagem_mobile_url), '') is not null);

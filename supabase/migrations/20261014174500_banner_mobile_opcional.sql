alter table public.banners_site
  alter column imagem_mobile_url drop not null;

alter table public.banners_site
  drop constraint if exists banners_site_tem_imagem_mobile;

alter table public.banners_site
  drop constraint if exists banners_site_tem_alguma_imagem;

alter table public.banners_site
  add constraint banners_site_tem_alguma_imagem
  check (
    nullif(btrim(imagem_desktop_url), '') is not null
    or nullif(btrim(imagem_mobile_url), '') is not null
  );

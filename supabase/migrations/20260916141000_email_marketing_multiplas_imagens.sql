alter table public.email_campanhas
  add column if not exists imagens_urls jsonb not null default '[]'::jsonb;

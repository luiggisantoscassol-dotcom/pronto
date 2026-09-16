alter table public.email_campanhas
  add column if not exists ordem_blocos jsonb not null
  default '["imagem", "titulo", "texto", "botao"]'::jsonb;

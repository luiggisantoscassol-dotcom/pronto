alter table public.email_campanhas
  add column if not exists estilos jsonb not null default '{}'::jsonb;

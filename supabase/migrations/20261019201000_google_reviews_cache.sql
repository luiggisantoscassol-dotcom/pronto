create table if not exists public.google_reviews_cache (
  id smallint primary key check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.google_reviews_cache enable row level security;
revoke all on table public.google_reviews_cache from anon, authenticated;

comment on table public.google_reviews_cache is
  'Cache privado das avaliações exibidas no site, atualizado pela Edge Function no máximo uma vez por dia.';

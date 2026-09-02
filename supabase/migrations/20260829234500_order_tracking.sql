alter table public.pedidos
  add column if not exists tracking_token uuid not null default gen_random_uuid();

create unique index if not exists pedidos_tracking_token_idx
  on public.pedidos (tracking_token);

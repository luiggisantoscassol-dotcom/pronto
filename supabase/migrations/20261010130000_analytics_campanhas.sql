alter table public.rastreio_carrinho
  add column if not exists session_id text,
  add column if not exists evento text,
  add column if not exists pagina text,
  add column if not exists url_path text,
  add column if not exists referrer text,
  add column if not exists origem text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists click_id text,
  add column if not exists produto_id text,
  add column if not exists valor numeric(12,2),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists rastreio_created_at_idx on public.rastreio_carrinho(created_at desc);
create index if not exists rastreio_evento_created_at_idx on public.rastreio_carrinho(evento,created_at desc);
create index if not exists rastreio_campanha_created_at_idx on public.rastreio_carrinho(utm_campaign,created_at desc);
create index if not exists rastreio_device_created_at_idx on public.rastreio_carrinho(device_id,created_at desc);
create index if not exists rastreio_session_idx on public.rastreio_carrinho(session_id);

create table if not exists public.google_merchant_sync (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.produtos(id) on delete set null,
  offer_id text not null unique,
  active boolean not null default false,
  last_synced_at timestamptz,
  removed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_merchant_sync enable row level security;

comment on table public.google_merchant_sync is
  'Estado interno da sincronização da fonte API do Google Merchant Center.';

create or replace function public.touch_google_merchant_sync_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists google_merchant_sync_updated_at on public.google_merchant_sync;
create trigger google_merchant_sync_updated_at
before update on public.google_merchant_sync
for each row execute function public.touch_google_merchant_sync_updated_at();

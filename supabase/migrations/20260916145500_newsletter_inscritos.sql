create table if not exists public.newsletter_inscritos (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  consentimento boolean not null default true,
  consentido_em timestamptz not null default now(),
  origem text not null default 'modal-site',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists newsletter_inscritos_email_unique_idx
  on public.newsletter_inscritos (lower(email));

alter table public.newsletter_inscritos enable row level security;
revoke all on table public.newsletter_inscritos from anon, authenticated;

drop policy if exists newsletter_inscritos_admin_only on public.newsletter_inscritos;
create policy newsletter_inscritos_admin_only on public.newsletter_inscritos
for all to authenticated using (public.is_admin()) with check (public.is_admin());

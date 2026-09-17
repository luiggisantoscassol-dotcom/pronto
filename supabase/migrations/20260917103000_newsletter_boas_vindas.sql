alter table public.newsletter_inscritos
  add column if not exists boas_vindas_status text,
  add column if not exists boas_vindas_enviado_em timestamptz,
  add column if not exists boas_vindas_resend_id text,
  add column if not exists boas_vindas_erro text;

alter table public.newsletter_inscritos
  drop constraint if exists newsletter_inscritos_boas_vindas_status_check;

alter table public.newsletter_inscritos
  add constraint newsletter_inscritos_boas_vindas_status_check
  check (boas_vindas_status is null or boas_vindas_status in ('enviando', 'enviado', 'erro'));

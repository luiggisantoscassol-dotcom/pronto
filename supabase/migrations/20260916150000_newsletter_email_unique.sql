alter table public.newsletter_inscritos
  add constraint newsletter_inscritos_email_key unique (email);

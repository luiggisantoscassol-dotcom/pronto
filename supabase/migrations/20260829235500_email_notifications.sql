alter table public.pedidos
  add column if not exists email_confirmacao_enviado_em timestamptz;

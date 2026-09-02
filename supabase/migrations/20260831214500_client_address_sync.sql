alter table public.clientes
  add column if not exists rua text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists cep text,
  add column if not exists cidade text,
  add column if not exists estado text;

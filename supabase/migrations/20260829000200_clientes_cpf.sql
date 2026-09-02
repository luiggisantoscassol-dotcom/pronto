alter table public.clientes
  add column if not exists cpf text;

create unique index if not exists clientes_cpf_unique_idx
  on public.clientes (cpf)
  where cpf is not null and cpf <> '';

alter table public.pedidos
  add column if not exists cliente_cpf text;

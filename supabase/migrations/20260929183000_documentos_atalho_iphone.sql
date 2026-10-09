-- Entrada segura de documentos pelo menu Compartilhar do iPhone.
-- Os tokens são guardados somente como SHA-256 e dão acesso apenas ao endpoint de upload.

create table if not exists public.documentos_atalho_dispositivos (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'iPhone' check (char_length(nome) between 2 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  token_prefix text not null check (char_length(token_prefix) between 6 and 16),
  user_id uuid not null references auth.users(id) on delete cascade,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_uso_em timestamptz,
  revogado_em timestamptz
);

alter table public.documentos_atalho_dispositivos enable row level security;

-- Sem políticas para clientes: criação, listagem e revogação passam exclusivamente
-- pela Edge Function, que autentica o administrador e nunca devolve token_hash.

create unique index if not exists documentos_contabeis_origem_idempotente_uidx
  on public.documentos_contabeis(origem_tipo, origem_id)
  where origem_tipo = 'atalho_ios' and origem_id is not null;

create index if not exists documentos_atalho_dispositivos_usuario_idx
  on public.documentos_atalho_dispositivos(user_id, ativo, criado_em desc);


-- O backup tecnico JSON passa a ter uma copia PDF de leitura e conferencia.
alter table public.livro_selos_backups
  add column if not exists pdf_arquivo_id text,
  add column if not exists pdf_arquivo_nome text,
  add column if not exists pdf_arquivo_url text;

comment on column public.livro_selos_backups.pdf_arquivo_url is
  'Link da copia PDF legivel gerada junto ao backup tecnico JSON.';

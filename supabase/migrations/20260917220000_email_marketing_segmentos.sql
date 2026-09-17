alter table public.email_campanhas
  add column if not exists segmento text not null default 'todos';

alter table public.email_campanhas
  drop constraint if exists email_campanhas_segmento_check;

alter table public.email_campanhas
  add constraint email_campanhas_segmento_check
  check (segmento in ('todos', 'compradores', 'sem_compra', 'inativos_60', 'gengibre', 'ouro', 'prata'));

alter table public.consignacao_empresas
  add column if not exists indicador_ie smallint;

alter table public.consignacao_empresas
  drop constraint if exists consignacao_empresas_indicador_ie_check;

alter table public.consignacao_empresas
  add constraint consignacao_empresas_indicador_ie_check
  check (indicador_ie is null or indicador_ie in (1, 2, 9));

comment on column public.consignacao_empresas.indicador_ie is
  'Indicador de inscrição estadual no Bling: 1 contribuinte ICMS, 2 contribuinte isento, 9 não contribuinte.';

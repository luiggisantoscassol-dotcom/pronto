create table if not exists public.compras_insumos (
  id uuid primary key default gen_random_uuid(),
  fornecedor text not null,
  numero_documento text,
  data_emissao date not null,
  valor_total numeric(12,2) check (valor_total is null or valor_total >= 0),
  observacoes text,
  arquivo_path text,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_bytes bigint check (arquivo_bytes is null or arquivo_bytes >= 0),
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create table if not exists public.compra_insumo_itens (
  id bigint generated always as identity primary key,
  compra_id uuid not null references public.compras_insumos(id) on delete cascade,
  insumo_id uuid not null references public.insumos_envase(id),
  quantidade integer not null check (quantidade > 0),
  unique (compra_id, insumo_id)
);

alter table public.compras_insumos enable row level security;
alter table public.compra_insumo_itens enable row level security;

create policy compras_insumos_admin on public.compras_insumos
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy compra_insumo_itens_admin on public.compra_insumo_itens
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create index if not exists compras_insumos_data_idx on public.compras_insumos (data_emissao desc, criado_em desc);
create index if not exists compra_insumo_itens_insumo_idx on public.compra_insumo_itens (insumo_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notas-compra',
  'notas-compra',
  false,
  15728640,
  array['application/pdf', 'application/xml', 'text/xml', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "purchase invoices admin read"
on storage.objects for select to authenticated
using (bucket_id = 'notas-compra' and public.is_admin());

create policy "purchase invoices admin insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'notas-compra' and public.is_admin());

create policy "purchase invoices admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'notas-compra' and public.is_admin());

create or replace function public.registrar_compra_insumos(
  p_id uuid,
  p_fornecedor text,
  p_numero_documento text,
  p_data_emissao date,
  p_valor_total numeric,
  p_observacoes text,
  p_arquivo_path text,
  p_arquivo_nome text,
  p_arquivo_mime text,
  p_arquivo_bytes bigint,
  p_itens jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_insumo uuid;
  v_quantidade integer;
  v_compra uuid := coalesce(p_id, gen_random_uuid());
  v_motivo text;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário'; end if;
  if length(trim(coalesce(p_fornecedor, ''))) < 2 then raise exception 'Informe o fornecedor'; end if;
  if p_data_emissao is null then raise exception 'Informe a data de emissão'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe ao menos um insumo'; end if;

  insert into public.compras_insumos(id,fornecedor,numero_documento,data_emissao,valor_total,observacoes,arquivo_path,arquivo_nome,arquivo_mime,arquivo_bytes,criado_por)
  values(v_compra,trim(p_fornecedor),nullif(trim(coalesce(p_numero_documento,'')),''),p_data_emissao,p_valor_total,nullif(trim(coalesce(p_observacoes,'')),''),nullif(p_arquivo_path,''),nullif(p_arquivo_nome,''),nullif(p_arquivo_mime,''),p_arquivo_bytes,auth.uid());

  v_motivo := 'Compra de insumos' || case when nullif(trim(coalesce(p_numero_documento,'')),'') is not null then ' · NF ' || trim(p_numero_documento) else '' end;
  for v_item in select value from jsonb_array_elements(p_itens)
  loop
    v_insumo := (v_item->>'insumo_id')::uuid;
    v_quantidade := (v_item->>'quantidade')::integer;
    if v_quantidade <= 0 then raise exception 'Quantidade de insumo inválida'; end if;
    perform 1 from public.insumos_envase where id=v_insumo for update;
    if not found then raise exception 'Insumo não encontrado'; end if;
    insert into public.compra_insumo_itens(compra_id,insumo_id,quantidade) values(v_compra,v_insumo,v_quantidade);
    update public.insumos_envase set quantidade=quantidade+v_quantidade, atualizado_em=now() where id=v_insumo;
    insert into public.movimentos_insumos_envase(insumo_id,quantidade,motivo,criado_por) values(v_insumo,v_quantidade,v_motivo,auth.uid());
  end loop;
  return v_compra;
end;
$$;

grant execute on function public.registrar_compra_insumos(uuid,text,text,date,numeric,text,text,text,text,bigint,jsonb) to authenticated;

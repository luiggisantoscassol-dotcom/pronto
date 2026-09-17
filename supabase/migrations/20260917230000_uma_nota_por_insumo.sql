create unique index if not exists compra_insumo_um_item_idx
  on public.compra_insumo_itens (compra_id);

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
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) <> 1 then raise exception 'Cada compra deve conter exatamente um insumo'; end if;

  insert into public.compras_insumos(id,fornecedor,numero_documento,data_emissao,valor_total,observacoes,arquivo_path,arquivo_nome,arquivo_mime,arquivo_bytes,criado_por)
  values(v_compra,trim(p_fornecedor),nullif(trim(coalesce(p_numero_documento,'')),''),p_data_emissao,p_valor_total,nullif(trim(coalesce(p_observacoes,'')),''),nullif(p_arquivo_path,''),nullif(p_arquivo_nome,''),nullif(p_arquivo_mime,''),p_arquivo_bytes,auth.uid());

  v_item := p_itens->0;
  v_insumo := (v_item->>'insumo_id')::uuid;
  v_quantidade := (v_item->>'quantidade')::integer;
  if v_quantidade <= 0 then raise exception 'Quantidade de insumo inválida'; end if;
  perform 1 from public.insumos_envase where id=v_insumo for update;
  if not found then raise exception 'Insumo não encontrado'; end if;
  v_motivo := 'Compra de insumo' || case when nullif(trim(coalesce(p_numero_documento,'')),'') is not null then ' · NF ' || trim(p_numero_documento) else '' end;
  insert into public.compra_insumo_itens(compra_id,insumo_id,quantidade) values(v_compra,v_insumo,v_quantidade);
  update public.insumos_envase set quantidade=quantidade+v_quantidade, atualizado_em=now() where id=v_insumo;
  insert into public.movimentos_insumos_envase(insumo_id,quantidade,motivo,criado_por) values(v_insumo,v_quantidade,v_motivo,auth.uid());
  return v_compra;
end;
$$;

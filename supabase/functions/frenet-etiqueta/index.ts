import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const parseLegacyAddress = (value: unknown): Record<string, string> => {
  const match = String(value || "").trim().match(/^(.+),\s*([^,]+?)\s*-\s*(.+),\s*([^/]+)\/([A-Za-z]{2})$/);
  return match ? { endereco: match[1].trim(), numero: match[2].trim(), bairro: match[3].trim(), cidade: match[4].trim(), uf: match[5].trim().toUpperCase() } : {};
};
const apiMessage = (data: any, status: number) => {
  const details = Array.isArray(data?.Details) ? data.Details.map((item: any) => item?.Message).filter(Boolean) : [];
  return [data?.Message || data?.message, ...details].filter(Boolean).join(" — ") || `Frenet (${status})`;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const bearer = request.headers.get("authorization") || "";
  const { data: authData, error: authError } = await db.auth.getUser(bearer.replace(/^Bearer\s+/i, ""));
  if (authError || !authData.user) return json({ error: "Acesso administrativo necessário." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (!admin) return json({ error: "Acesso administrativo necessário." }, 403);

  const input = await request.json().catch(() => ({}));
  const referencia = String(input?.referencia || "");
  const action = String(input?.action || "consultar");
  if (action === "validar_conexao") {
    const token = Deno.env.get("FRENET_TOKEN") || "";
    const partner = Deno.env.get("FRENET_PARTNER_TOKEN") || "";
    if (!token || !partner) return json({ error: "Cadastre FRENET_TOKEN e FRENET_PARTNER_TOKEN no Supabase." }, 409);
    try {
      const response = await fetch("https://whitelabel.frenet.com.br/v1/wallet", {
        method: "GET",
        headers: { token, "x-partner-token": partner, accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: response.status === 401 ? "A Frenet recusou um dos tokens. Confira o Token do Cliente e o Partner Token." : apiMessage(data, response.status) }, response.status === 401 ? 401 : 422);
      return json({ ok: true, message: "Conexão Frenet validada com sucesso." });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Não foi possível acessar a Frenet." }, 502);
    }
  }
  if (!referencia || !["consultar", "preparar", "comprar"].includes(action)) return json({ error: "Pedido ou ação inválida." }, 400);
  const { data: order, error: orderError } = await db.from("pedidos")
    .select("id,referencia,created_at,cliente_nome,cliente_email,cliente_telefone,cliente_cpf,endereco,itens_json,total,frete,frete_detalhes,bling_nfe_numero,bling_nfe_chave_acesso")
    .eq("referencia", referencia).maybeSingle();
  if (orderError || !order) return json({ error: "Pedido não encontrado." }, 404);
  const details: any = order.frete_detalhes && typeof order.frete_detalhes === "object" ? order.frete_detalhes : {};
  const frenetCompatible = String(details.origem || "").trim().toLowerCase() === "frenet" || (
    !details.origem && Boolean(details.servico) && Boolean(details.transportadora) && !details.melhor_envio_order_id
  );
  if (!frenetCompatible) return json({ error: "Este pedido não utiliza a Frenet." }, 400);

  const save = async (patch: Record<string, unknown>) => {
    const merged = { ...details, origem: "frenet", ...patch };
    const { error } = await db.from("pedidos").update({ frete_detalhes: merged }).eq("id", order.id);
    if (error) throw new Error(error.message);
    return merged;
  };
  const planejarEmbalagens = async (quantidade: number, volumeUnico: boolean) => {
    const { data: caixas, error } = await db.from("embalagens").select("id,nome,capacidade_garrafas,estoque,altura_cm,largura_cm,comprimento_cm,peso_vazio_kg,especie,marca,numeracao").eq("ativo", true).gt("estoque", 0);
    if (error) throw new Error(`Não foi possível consultar as caixas: ${error.message}`);
    if (!caixas?.length) throw new Error("Cadastre caixas com estoque na aba Embalagens.");
    if (volumeUnico) {
      const caixa = [...caixas].filter((item: any) => Number(item.capacidade_garrafas) >= quantidade).sort((a: any, b: any) => Number(a.capacidade_garrafas) - Number(b.capacidade_garrafas))[0];
      if (!caixa) throw new Error(`Este serviço exige um volume. Cadastre uma caixa para pelo menos ${quantidade} garrafa(s).`);
      return [{ ...caixa, quantidade: 1 }];
    }
    const unidades = caixas.flatMap((caixa: any) => Array.from({ length: Number(caixa.estoque) }, () => caixa));
    const limite = quantidade + Math.max(...caixas.map((caixa: any) => Number(caixa.capacidade_garrafas))) - 1;
    const dp: Array<any[] | null> = Array(limite + 1).fill(null); dp[0] = [];
    for (const caixa of unidades) for (let total = limite - Number(caixa.capacidade_garrafas); total >= 0; total--) {
      if (!dp[total]) continue;
      const next = total + Number(caixa.capacidade_garrafas), candidate = [...dp[total]!, caixa];
      if (!dp[next] || candidate.length < dp[next]!.length) dp[next] = candidate;
    }
    let chosen: any[] | null = null;
    for (let total = quantidade; total <= limite; total++) if (dp[total]) { chosen = dp[total]; break; }
    if (!chosen) throw new Error(`Não há caixas suficientes para ${quantidade} garrafa(s).`);
    const grouped = new Map<string, any>();
    chosen.forEach((caixa: any) => grouped.set(caixa.id, { ...caixa, quantidade: (grouped.get(caixa.id)?.quantidade || 0) + 1 }));
    return [...grouped.values()];
  };

  try {
    if (action === "consultar") return json({ ok: true, frete: details, parceiro_configurado: Boolean(Deno.env.get("FRENET_PARTNER_TOKEN")) });
    if (action === "preparar" && details.etiqueta_status === "preparada" && Array.isArray(details.embalagens)) return json({ ok: true, frete: details });
    const recipient: any = details.destinatario && typeof details.destinatario === "object" ? details.destinatario : {};
    const legacy = parseLegacyAddress(order.endereco);
    const to = { nome: recipient.nome || order.cliente_nome, email: recipient.email || order.cliente_email, telefone: recipient.telefone || order.cliente_telefone, documento: recipient.documento || order.cliente_cpf, endereco: recipient.endereco || legacy.endereco, numero: recipient.numero || legacy.numero, complemento: recipient.complemento || "", bairro: recipient.bairro || legacy.bairro, cidade: recipient.cidade || legacy.cidade, uf: recipient.uf || legacy.uf, cep: recipient.cep || details.cep_destino };
    if (!to.nome || digits(to.documento).length < 11 || !to.endereco || !to.numero || !to.bairro || !to.cidade || !to.uf || digits(to.cep).length !== 8) return json({ error: "Nome, CPF/CNPJ ou endereço do destinatário está incompleto." }, 422);
    const items: any[] = Array.isArray(order.itens_json) ? order.itens_json : [];
    const quantity = items.reduce((sum, item) => sum + Number(item.quantidade || 0) * Math.max(1, Number(item.unidades_por_kit || 1)), 0);
    if (!quantity) return json({ error: "O pedido não possui garrafas para envio." }, 422);
    const oneVolume = String(details.transportadora || "").toLowerCase().includes("correios");
    const boxes = action === "comprar" && Array.isArray(details.embalagens) && details.embalagens.length ? details.embalagens : await planejarEmbalagens(quantity, oneVolume);
    let remaining = quantity;
    const volumes = boxes.flatMap((box: any) => Array.from({ length: Number(box.quantidade || 1) }, () => {
      const bottles = Math.min(remaining, Number(box.capacidade_garrafas)); remaining -= bottles;
      return { Weight: Number((Number(box.peso_vazio_kg || 0) + bottles * Number(details.peso_por_garrafa_kg || 1.5)).toFixed(3)), Length: Number(box.comprimento_cm), Height: Number(box.altura_cm), Width: Number(box.largura_cm), Price: Number(order.total || 0) - Number(order.frete || 0), DeclaredValue: Number(order.total || 0) - Number(order.frete || 0) };
    }));
    const boxSummary = boxes.map((box: any) => ({ embalagem_id: box.embalagem_id || box.id, nome: box.nome, quantidade: Number(box.quantidade || 1), capacidade_garrafas: Number(box.capacidade_garrafas), altura_cm: Number(box.altura_cm), largura_cm: Number(box.largura_cm), comprimento_cm: Number(box.comprimento_cm), peso_vazio_kg: Number(box.peso_vazio_kg || 0), especie: box.especie, marca: box.marca, numeracao: box.numeracao }));
    if (action === "preparar") {
      const frete = await save({ destinatario: to, etiqueta_status: "preparada", etiqueta_preparada_em: new Date().toISOString(), quantidade_garrafas: quantity, embalagens: boxSummary, volumes });
      return json({ ok: true, frete, parceiro_configurado: Boolean(Deno.env.get("FRENET_PARTNER_TOKEN")) });
    }
    if (details.frenet_shipment_id) {
      if (!details.embalagem_baixa?.ok) {
        const { data: baixa, error: baixaError } = await db.rpc("baixar_estoque_embalagens", { p_pedido_id: order.id, p_referencia: order.referencia, p_melhor_envio_order_id: `frenet:${details.frenet_shipment_id}`, p_quantidade_garrafas: quantity, p_itens: boxSummary.map((box: any) => ({ embalagem_id: box.embalagem_id, nome: box.nome, quantidade: box.quantidade })) });
        if (baixaError) throw new Error(`A etiqueta já existe; a baixa das caixas ainda falhou: ${baixaError.message}`);
        const frete = await save({ embalagem_baixa: baixa, embalagens_baixadas_em: new Date().toISOString() });
        return json({ ok: true, frete, url: details.etiqueta_url, ja_comprada: true });
      }
      return json({ ok: true, frete: details, url: details.etiqueta_url, ja_comprada: true });
    }
    const token = Deno.env.get("FRENET_TOKEN") || "", partner = Deno.env.get("FRENET_PARTNER_TOKEN") || "";
    if (!token || !partner) return json({ error: "A emissão exige FRENET_TOKEN e FRENET_PARTNER_TOKEN no Supabase. A etiqueta não foi comprada." }, 409);
    const orderItems = items.map((item: any, index: number) => ({ OrderId: order.referencia, ItemId: `${order.referencia}-${index + 1}`, ProductId: String(item.bling_id || item.id || index + 1), ProductType: "Bebida", Weight: 1.5, Length: 12, Height: 36, Width: 12, Quantity: Number(item.quantidade || 1), Price: Number(item.preco || 0), IsFragile: true, ProductName: item.nome, SKU: String(item.bling_id || item.id || "garrafa"), Category: "Bebidas" }));
    const invoiceKey = digits(order.bling_nfe_chave_acesso);
    const payload: any = [{
      Order: { Id: order.referencia, Value: Number(order.total || 0) - Number(order.frete || 0), Created: order.created_at, UseFrenetRegistration: true, Items: orderItems, To: { Name: to.nome, Email: to.email, Phone: digits(to.telefone), Cellphone: digits(to.telefone), Document: digits(to.documento), Address: { ZipCode: digits(to.cep), City: to.cidade, Street: to.endereco, AddressNumber: String(to.numero), AddressComplement: to.complemento || "", AddressQuarter: to.bairro, AddressState: to.uf, Country: "BR" } } },
      Volumes: volumes,
      Quotation: { ShippingServiceCode: String(details.servico_id || ""), ShippingServiceName: String(details.servico || ""), PlatformShippingPrice: Number(details.preco || order.frete || 0), DeliveryTime: Number(details.prazo_dias_uteis || 0), Carrier: String(details.transportadora || ""), CarrierCode: String(details.transportadora_codigo || details.carrier_code || ""), ShippingPrice: Number(details.preco_original || details.preco || order.frete || 0), Services: { DeclaredValue: true, ReceiptNotification: false, OwnHand: false } }
    }];
    if (invoiceKey) payload[0].Order.Invoice = { Value: Number(order.total || 0), Number: String(order.bling_nfe_numero || ""), Key: invoiceKey, Date: new Date().toISOString() };
    const response = await fetch("https://whitelabel.frenet.com.br/v1/orders/oneclick", { method: "POST", headers: { token, "x-partner-token": partner, "x-printing-format": "A4", accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiMessage(data, response.status));
    const result = Array.isArray(data?.Items) ? data.Items[0] : Array.isArray(data?.items) ? data.items[0] : null;
    const shipmentId = String(result?.ShipmentId || result?.shipmentId || "");
    const labelUrl = String(result?.LabelUrl || result?.labelUrl || "");
    const errors = result?.Errors || result?.errors;
    if (!shipmentId || !labelUrl || (Array.isArray(errors) && errors.length)) throw new Error(apiMessage({ Message: "A Frenet não concluiu a etiqueta.", Details: errors }, 422));
    const trackingUrl = String(result?.TrackingUrl || result?.trackingUrl || "");
    const trackingCode = trackingUrl.split("/").filter(Boolean).pop() || "";
    const createdFrete = await save({ frenet_shipment_id: shipmentId, etiqueta_status: "gerada", etiqueta_comprada_em: new Date().toISOString(), etiqueta_gerada_em: new Date().toISOString(), etiqueta_url: labelUrl, declaracao_url: result?.DeclarationUrl || result?.declarationUrl || null, rastreio_url: trackingUrl || null, codigo_rastreio: trackingCode || null, embalagens: boxSummary });
    const { data: baixa, error: baixaError } = await db.rpc("baixar_estoque_embalagens", { p_pedido_id: order.id, p_referencia: order.referencia, p_melhor_envio_order_id: `frenet:${shipmentId}`, p_quantidade_garrafas: quantity, p_itens: boxSummary.map((box: any) => ({ embalagem_id: box.embalagem_id, nome: box.nome, quantidade: box.quantidade })) });
    if (baixaError) throw new Error(`Etiqueta criada e registrada, mas a baixa das caixas falhou: ${baixaError.message}. Tente novamente; não haverá nova cobrança.`);
    const frete = await save({ ...createdFrete, embalagem_baixa: baixa, embalagens_baixadas_em: new Date().toISOString() });
    return json({ ok: true, frete, url: labelUrl });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Falha na integração com a Frenet." }, 422); }
});

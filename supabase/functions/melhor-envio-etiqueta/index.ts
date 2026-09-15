import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8" },
});
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const parseLegacyAddress = (value: unknown): Record<string, string> => {
  const address = String(value || "").trim();
  const match = address.match(/^(.+),\s*([^,]+?)\s*-\s*(.+),\s*([^/]+)\/([A-Za-z]{2})$/);
  if (!match) return {};
  return {
    endereco: match[1].trim(),
    numero: match[2].trim(),
    bairro: match[3].trim(),
    cidade: match[4].trim(),
    uf: match[5].trim().toUpperCase(),
  };
};
const apiErrorMessage = (result: any, status: number) => {
  const primary = result?.message || result?.error;
  const fields = result?.errors && typeof result.errors === "object"
    ? Object.entries(result.errors).flatMap(([field, messages]) => {
      const list = Array.isArray(messages) ? messages : [messages];
      return list.filter(Boolean).map((message) => `${field}: ${String(message)}`);
    })
    : [];
  const baseMessage = typeof primary === "string" ? primary : "";
  if (status === 403 && /unauthorized|não autorizad|nao autorizad/i.test(baseMessage)) {
    return "O Melhor Envio recusou esta ação. Reconecte o aplicativo para autorizar o acesso ao carrinho de etiquetas.";
  }
  return [baseMessage, ...fields].filter(Boolean).join(" — ") || `Melhor Envio (${status})`;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, serviceKey);
  const bearer = request.headers.get("authorization") || "";
  const userToken = bearer.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await db.auth.getUser(userToken);
  if (authError || !authData.user) return json({ error: "Acesso administrativo necessário." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (!admin) return json({ error: "Acesso administrativo necessário." }, 403);

  const input = await request.json().catch(() => ({}));
  const referencia = String(input?.referencia || "");
  const action = String(input?.action || "consultar");
  if (!referencia) return json({ error: "Pedido não informado." }, 400);

  const { data: order, error: orderError } = await db.from("pedidos")
    .select("id,referencia,cliente_nome,cliente_email,cliente_telefone,cliente_cpf,endereco,itens_json,total,frete,frete_detalhes,bling_nfe_chave_acesso")
    .eq("referencia", referencia).maybeSingle();
  if (orderError || !order) return json({ error: "Pedido não encontrado." }, 404);
  const details = order.frete_detalhes && typeof order.frete_detalhes === "object" ? order.frete_detalhes : {};
  if (details.origem !== "melhor_envio") return json({ error: "Este pedido não utiliza transportadora do Melhor Envio." }, 400);

  const environment = String(Deno.env.get("MELHOR_ENVIO_ENVIRONMENT") || "production").toLowerCase();
  const base = environment === "sandbox" ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
  const { data: integration } = await db.from("melhor_envio_integracao").select("access_token,refresh_token,expires_at").eq("id", "principal").maybeSingle();
  if (!integration?.access_token) return json({ error: "Conecte o Melhor Envio novamente no painel." }, 409);

  let accessToken = String(integration.access_token);
  if (integration.expires_at && new Date(integration.expires_at).getTime() < Date.now() + 60_000) {
    const refreshResponse = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token,
        client_id: Deno.env.get("MELHOR_ENVIO_CLIENT_ID"),
        client_secret: Deno.env.get("MELHOR_ENVIO_CLIENT_SECRET"),
      }),
    });
    const refreshed = await refreshResponse.json().catch(() => ({}));
    if (!refreshResponse.ok || !refreshed.access_token) return json({ error: "A conexão com o Melhor Envio expirou. Reconecte o aplicativo." }, 401);
    accessToken = String(refreshed.access_token);
    await db.from("melhor_envio_integracao").update({
      access_token: accessToken,
      refresh_token: refreshed.refresh_token || integration.refresh_token,
      expires_at: new Date(Date.now() + Number(refreshed.expires_in || 2_592_000) * 1000).toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq("id", "principal");
  }

  const api = async (path: string, method = "POST", body?: unknown) => {
    const response = await fetch(`${base}/api/v2${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "content-type": "application/json", "user-agent": "Tio Nan (contato@tionan.com.br)" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrorMessage(result, response.status));
    return result;
  };
  const save = async (patch: Record<string, unknown>) => {
    const merged = { ...details, ...patch };
    const { error } = await db.from("pedidos").update({ frete_detalhes: merged }).eq("id", order.id);
    if (error) throw new Error(error.message);
    return merged;
  };
  const planejarEmbalagens = async (quantidadeGarrafas: number, volumeUnico = false) => {
    const { data: caixas, error } = await db.from("embalagens").select("id,nome,capacidade_garrafas,estoque,altura_cm,largura_cm,comprimento_cm,peso_vazio_kg,especie,marca,numeracao").eq("ativo", true).gt("estoque", 0);
    if (error) throw new Error(`Não foi possível consultar o estoque de embalagens: ${error.message}`);
    if (!caixas?.length) throw new Error("Cadastre caixas com estoque na aba Embalagens antes de preparar o envio.");
    if (volumeUnico) {
      const caixa = [...caixas]
        .filter((item: any) => Number(item.capacidade_garrafas) >= quantidadeGarrafas)
        .sort((a: any, b: any) => Number(a.capacidade_garrafas) - Number(b.capacidade_garrafas))[0];
      if (!caixa) {
        throw new Error(`Os Correios aceitam somente uma caixa por etiqueta. Cadastre uma embalagem com capacidade para pelo menos ${quantidadeGarrafas} garrafa(s).`);
      }
      return [{ ...caixa, quantidade: 1 }];
    }
    const unidades = caixas.flatMap((caixa: any) => Array.from({ length: Number(caixa.estoque) }, () => caixa));
    const maxCapacidade = Math.max(...caixas.map((caixa: any) => Number(caixa.capacidade_garrafas)));
    const limite = quantidadeGarrafas + maxCapacidade - 1;
    const dp: Array<any[] | null> = Array(limite + 1).fill(null); dp[0] = [];
    for (const caixa of unidades) {
      const capacidade = Number(caixa.capacidade_garrafas);
      for (let total = limite - capacidade; total >= 0; total--) {
        if (!dp[total]) continue;
        const proximo = total + capacidade;
        const candidato = [...dp[total]!, caixa];
        if (!dp[proximo] || candidato.length < dp[proximo]!.length) dp[proximo] = candidato;
      }
    }
    let escolhidas: any[] | null = null;
    for (let total = quantidadeGarrafas; total <= limite; total++) if (dp[total]) { escolhidas = dp[total]; break; }
    if (!escolhidas) throw new Error(`Não há caixas suficientes para enviar ${quantidadeGarrafas} garrafa(s). Ajuste o estoque na aba Embalagens.`);
    const agrupadas = new Map<string, any>();
    escolhidas.forEach((caixa: any) => agrupadas.set(caixa.id, { ...caixa, quantidade: (agrupadas.get(caixa.id)?.quantidade || 0) + 1 }));
    return Array.from(agrupadas.values());
  };

  try {
    const shipmentId = String(details.melhor_envio_order_id || "");
    if (action === "consultar") return json({ ok: true, ambiente: environment, frete: details });

    if (action === "preparar") {
      if (shipmentId) return json({ ok: true, ambiente: environment, frete: details });
      const savedRecipient = details.destinatario && typeof details.destinatario === "object" ? details.destinatario : {};
      const legacyAddress = parseLegacyAddress(order.endereco);
      const to = {
        nome: savedRecipient.nome || order.cliente_nome,
        email: savedRecipient.email || order.cliente_email,
        telefone: savedRecipient.telefone || order.cliente_telefone,
        documento: savedRecipient.documento || order.cliente_cpf,
        endereco: savedRecipient.endereco || legacyAddress.endereco,
        numero: savedRecipient.numero || legacyAddress.numero,
        complemento: savedRecipient.complemento || "",
        bairro: savedRecipient.bairro || legacyAddress.bairro,
        cidade: savedRecipient.cidade || legacyAddress.cidade,
        uf: savedRecipient.uf || legacyAddress.uf,
        cep: savedRecipient.cep || details.cep_destino,
      };
      if (!to.endereco || !to.numero || !to.bairro || !to.cidade || !to.uf || digits(to.cep).length !== 8) {
        return json({ error: "O endereço deste pedido está incompleto. Confira rua, número, bairro, cidade, UF e CEP antes de preparar a etiqueta." }, 422);
      }
      const items = Array.isArray(order.itens_json) ? order.itens_json : [];
      const quantity = items.reduce((sum: number, item: any) => sum + Number(item.quantidade || 0) * Math.max(1, Number(item.unidades_por_kit || 1)), 0);
      if (quantity < 1) return json({ error: "O pedido não possui garrafas para envio." }, 422);
      const transportadora = String(details.transportadora || "").toLowerCase();
      const exigeVolumeUnico = transportadora.includes("correios");
      const embalagens = await planejarEmbalagens(quantity, exigeVolumeUnico);
      let garrafasRestantes = quantity;
      const volumes = embalagens.flatMap((caixa: any) => Array.from({ length: Number(caixa.quantidade) }, () => {
        const nestaCaixa = Math.min(garrafasRestantes, Number(caixa.capacidade_garrafas));
        garrafasRestantes -= nestaCaixa;
        return {
          height: Number(caixa.altura_cm), width: Number(caixa.largura_cm), length: Number(caixa.comprimento_cm),
          weight: Number((Number(caixa.peso_vazio_kg || 0) + nestaCaixa * Number(details.peso_por_garrafa_kg || 1.5)).toFixed(3)),
        };
      }));
      const invoiceKey = digits(order.bling_nfe_chave_acesso);
      const payload = {
        service: Number(details.servico_id),
        from: {
          name: Deno.env.get("MELHOR_ENVIO_FROM_NAME") || "Tio Nan",
          phone: digits(Deno.env.get("MELHOR_ENVIO_FROM_PHONE") || "51989067003"),
          email: Deno.env.get("MELHOR_ENVIO_FROM_EMAIL") || "contato@tionan.com.br",
          company_document: digits(Deno.env.get("MELHOR_ENVIO_FROM_DOCUMENT") || "47112849000110"),
          state_register: String(Deno.env.get("MELHOR_ENVIO_FROM_STATE_REGISTER") || ""),
          address: Deno.env.get("MELHOR_ENVIO_FROM_ADDRESS") || "Avenida Bento Gonçalves",
          number: Deno.env.get("MELHOR_ENVIO_FROM_NUMBER") || "4321",
          complement: Deno.env.get("MELHOR_ENVIO_FROM_COMPLEMENT") || "",
          district: Deno.env.get("MELHOR_ENVIO_FROM_DISTRICT") || "Partenon",
          city: Deno.env.get("MELHOR_ENVIO_FROM_CITY") || "Porto Alegre",
          state_abbr: Deno.env.get("MELHOR_ENVIO_FROM_STATE") || "RS",
          country_id: "BR",
          postal_code: digits(Deno.env.get("MELHOR_ENVIO_FROM_POSTAL_CODE") || "90650003"),
        },
        to: {
          name: to.nome || order.cliente_nome,
          phone: digits(to.telefone || order.cliente_telefone),
          email: to.email || order.cliente_email,
          document: digits(to.documento || order.cliente_cpf),
          address: to.endereco,
          number: to.numero,
          complement: to.complemento || "",
          district: to.bairro,
          city: to.cidade,
          state_abbr: to.uf,
          country_id: "BR",
          postal_code: digits(to.cep),
        },
        products: items.map((item: any) => ({ name: item.nome, quantity: Number(item.quantidade), unitary_value: Number(item.preco) })),
        volumes,
        options: {
          insurance_value: Math.max(0, Number(order.total || 0) - Number(order.frete || 0)),
          receipt: false, own_hand: false, reverse: false,
          non_commercial: !invoiceKey,
          invoice: invoiceKey ? { key: invoiceKey } : undefined,
          platform: "Tio Nan",
          tags: [{ tag: String(order.referencia).slice(0, 8).toUpperCase(), url: "" }],
        },
      };
      const created = await api("/me/cart", "POST", payload);
      const id = String(created?.id || "");
      if (!id) throw new Error("O Melhor Envio não retornou o código da etiqueta.");
      const frete = await save({ destinatario: to, melhor_envio_order_id: id, etiqueta_status: "preparada", etiqueta_preparada_em: new Date().toISOString(), quantidade_garrafas: quantity, embalagens: embalagens.map((caixa: any) => ({ embalagem_id: caixa.id, nome: caixa.nome, quantidade: caixa.quantidade, capacidade_garrafas: caixa.capacidade_garrafas, especie: caixa.especie, marca: caixa.marca, numeracao: caixa.numeracao })) });
      return json({ ok: true, ambiente: environment, frete });
    }

    if (!shipmentId) return json({ error: "Prepare a etiqueta antes de continuar." }, 409);
    if (action === "comprar") {
      const result = await api("/me/shipment/checkout", "POST", { orders: [shipmentId] });
      const frete = await save({ etiqueta_status: "comprada", etiqueta_comprada_em: new Date().toISOString() });
      return json({ ok: true, ambiente: environment, resultado: result, frete });
    }
    if (action === "gerar") {
      let printUrl = String(details.etiqueta_url || "");
      if (details.etiqueta_status !== "gerada") {
        await api("/me/shipment/generate", "POST", { orders: [shipmentId] });
        const printed = await api("/me/shipment/print", "POST", { orders: [shipmentId], mode: "public" });
        printUrl = String(printed?.url || printed?.data?.url || "");
        await save({ etiqueta_status: "gerada", etiqueta_gerada_em: new Date().toISOString(), etiqueta_url: printUrl || null });
      }
      const embalagens = Array.isArray(details.embalagens) && details.embalagens.length
        ? details.embalagens
        : await planejarEmbalagens(Number(details.quantidade_garrafas || details.quantidade_produtos || (Array.isArray(order.itens_json) ? order.itens_json.reduce((s: number, i: any) => s + Number(i.quantidade || 0) * Math.max(1, Number(i.unidades_por_kit || 1)), 0) : 0)));
      const quantidadeGarrafas = Number(details.quantidade_garrafas || details.quantidade_produtos || (Array.isArray(order.itens_json) ? order.itens_json.reduce((s: number, i: any) => s + Number(i.quantidade || 0) * Math.max(1, Number(i.unidades_por_kit || 1)), 0) : 0));
      const { data: baixa, error: baixaError } = await db.rpc("baixar_estoque_embalagens", { p_pedido_id: order.id, p_referencia: order.referencia, p_melhor_envio_order_id: shipmentId, p_quantidade_garrafas: quantidadeGarrafas, p_itens: embalagens.map((caixa: any) => ({ embalagem_id: caixa.embalagem_id || caixa.id, nome: caixa.nome, quantidade: caixa.quantidade })) });
      if (baixaError) throw new Error(`A etiqueta foi gerada, mas a baixa das caixas falhou: ${baixaError.message}. Tente gerar novamente; não haverá cobrança duplicada.`);
      const frete = await save({ etiqueta_status: "gerada", etiqueta_gerada_em: details.etiqueta_gerada_em || new Date().toISOString(), etiqueta_url: printUrl || null, embalagem_baixa: baixa, embalagens_baixadas_em: new Date().toISOString() });
      return json({ ok: true, ambiente: environment, url: printUrl, frete });
    }
    if (action === "rastrear") {
      const tracked = await api("/me/shipment/tracking", "POST", { orders: [shipmentId] });
      const info = tracked?.[shipmentId] || tracked?.data?.[shipmentId] || tracked;
      const tracking = String(info?.tracking || info?.tracking_code || details.codigo_rastreio || "");
      const frete = await save({ codigo_rastreio: tracking || null, rastreio_detalhes: info, rastreio_consultado_em: new Date().toISOString() });
      return json({ ok: true, ambiente: environment, rastreio: info, frete });
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Falha na integração com o Melhor Envio." }, 422);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderConfirmation } from "../_shared/order-email.ts";

const MP_API = "https://api.mercadopago.com";
const DEFAULT_SITE = "https://www.tionan.com.br";
const ALLOWED_ORIGINS = new Set([
  "https://www.tionan.com.br",
  "https://tionan.com.br",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://192.168.0.103:8000",
  "http://192.168.2.110:8080",
  "http://172.20.10.3:8000",
]);

const normalize = (value = "") => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").replace(/^cachaca\s+(de\s+)?/, "").trim();
const cleanPhone = (value = "") => value.replace(/\D/g, "");
const isValidEmail = (value = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidCpf = (value = "") => {
  const cpf = value.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
};
const money = (value: number) => Number(value.toFixed(2));
const fallbackCatalog: Record<string, { name: string; price: number; blingId?: string }> = {
  "gengibre guaco e mel": { name: "Gengibre, Guaco e Mel", price: 55, blingId: "16699719562" },
  "ouro": { name: "Cachaça Ouro", price: 50, blingId: "16699660347" },
  "prata": { name: "Cachaça Prata", price: 50, blingId: "16687078597" },
};

const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_SITE,
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "Origin",
});
const respond = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" },
});

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return respond(origin, { error: "Use POST." }, 405);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond(origin, { error: "Origem não autorizada." }, 403);

  const payload = await request.json().catch(() => null);
  const sandbox = payload?.sandbox === true;
  const isTest = payload?.pagamento === "Teste" || payload?.teste === true;
  const isCash = payload?.pagamento === "Dinheiro";
  const accessToken = isCash || isTest ? "" : Deno.env.get(sandbox ? "MERCADO_PAGO_TEST_ACCESS_TOKEN" : "MERCADO_PAGO_ACCESS_TOKEN");
  if (!isCash && !isTest && !accessToken) return respond(origin, { error: `Mercado Pago ${sandbox ? "de teste " : ""}ainda não foi configurado.` }, 500);
  const cpf = String(payload?.cpf || "").replace(/\D/g, "");
  const email = String(payload?.email || "").trim().toLowerCase();
  const name = String(payload?.nome || "").trim();
  const phone = cleanPhone(String(payload?.telefone || ""));
  const requestedDelivery = String(payload?.entrega || "");
  const delivery = requestedDelivery === "tele" || requestedDelivery === "retirada" || requestedDelivery.startsWith("melhor-envio:") || requestedDelivery.startsWith("frenet:") ? requestedDelivery : "";
  const incomingItems = Array.isArray(payload?.itens) ? payload.itens.slice(0, 20) : [];
  if (!isValidCpf(cpf) || !isValidEmail(email) || name.length < 3 || phone.length < 10 || !delivery || !incomingItems.length) {
    return respond(origin, { error: "Dados do pedido incompletos." }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (isTest) {
    const bearer = request.headers.get("authorization") || "";
    const userToken = bearer.replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await db.auth.getUser(userToken);
    if (authError || !authData.user) return respond(origin, { error: "Entre no painel administrativo para criar pedidos de teste." }, 401);
    const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
    if (!admin) return respond(origin, { error: "Apenas administradores podem criar pedidos de teste." }, 403);
  }
  const { data: products, error: productsError } = await db
    .from("produtos")
    .select("id,nome,preco,estoque,bling_id,excluido,tipo_produto,unidades_por_kit")
    .eq("excluido", false);
  if (productsError) return respond(origin, { error: "Não foi possível validar os produtos." }, 500);
  const { data: componentRows, error: componentsError } = await db
    .from("produto_componentes")
    .select("kit_id,componente_id,quantidade,componente:produtos!produto_componentes_componente_id_fkey(id,nome,bling_id,preco)");
  if (componentsError) return respond(origin, { error: "Não foi possível validar a composição dos kits." }, 500);

  const lines: Array<Record<string, unknown>> = [];
  for (const raw of incomingItems) {
    const quantity = Math.max(1, Math.min(12, Math.trunc(Number(raw?.quantidade || raw?.qtd || 0))));
    const incomingId = String(raw?.id || "");
    const incomingName = String(raw?.nome || raw?.name || "");
    const key = normalize(incomingName);
    const product = (products || []).find((item) => String(item.id) === incomingId || normalize(item.nome) === key);
    const fallback = fallbackCatalog[key];
    if (!product && !fallback) return respond(origin, { error: `Produto inválido: ${incomingName}` }, 400);
    const unitPrice = money(Number(product?.preco ?? fallback?.price ?? 0));
    if (!(unitPrice > 0)) return respond(origin, { error: `Preço inválido: ${incomingName}` }, 400);
    if (
      product &&
      product.estoque !== null &&
      product.estoque !== undefined &&
      Number.isFinite(Number(product.estoque)) &&
      Number(product.estoque) < quantity
    ) {
      return respond(origin, { error: `Estoque insuficiente para ${product.nome}.` }, 409);
    }
    const componentes = product?.tipo_produto === "kit"
      ? (componentRows || []).filter((row: any) => String(row.kit_id) === String(product.id)).map((row: any) => ({
          id: row.componente_id,
          nome: row.componente?.nome,
          bling_id: row.componente?.bling_id ? String(row.componente.bling_id) : null,
          preco_referencia: Number(row.componente?.preco || 0),
          quantidade: Number(row.quantidade || 0),
        }))
      : [];
    if (product?.tipo_produto === "kit" && !componentes.length) return respond(origin, { error: `O kit ${product.nome} está sem composição.` }, 409);
    lines.push({
      id: product?.id ?? incomingId,
      nome: product?.nome ?? fallback.name,
      quantidade: quantity,
      preco: unitPrice,
      bling_id: product?.bling_id ? String(product.bling_id) : fallback?.blingId || null,
      tipo_produto: product?.tipo_produto || "unitario",
      unidades_por_kit: Number(product?.unidades_por_kit || 1),
      componentes,
    });
  }

  const totalBottles = lines.reduce((sum, item) => sum + Number(item.quantidade) * Number(item.unidades_por_kit || 1), 0);
  const subtotal = money(lines.reduce((sum, item) => sum + Number(item.preco) * Number(item.quantidade), 0));
  const carrierDelivery = delivery.startsWith("melhor-envio:") || delivery.startsWith("frenet:");
  let carrierQuote: Record<string, unknown> | null = null;
  let carrierDestination = "";
  let carrierOrigin = "";
  if (carrierDelivery) {
    const serviceId = delivery.slice(delivery.indexOf(":") + 1);
    carrierDestination = String(payload?.endereco?.cep || "").replace(/\D/g, "");
    if (delivery.startsWith("frenet:")) {
      const frenetToken = Deno.env.get("FRENET_TOKEN") || "";
      carrierOrigin = String(Deno.env.get("FRENET_FROM_POSTAL_CODE") || "90650003").replace(/\D/g, "");
      if (!frenetToken || carrierDestination.length !== 8) return respond(origin, { error: "Frete Frenet inválido. Consulte o CEP novamente." }, 400);
      const quoteResponse = await fetch("https://api.frenet.com.br/shipping/quote", {
        method: "POST",
        headers: { token: frenetToken, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ SellerCEP: carrierOrigin, RecipientCEP: carrierDestination, RecipientCountry: "BR", ShipmentInvoiceValue: subtotal, ShippingItemArray: [{ Weight: 1.5, Length: 12, Height: 36, Width: 12, Quantity: totalBottles, SKU: "garrafa-700ml", Category: "Bebidas", isFragile: true }] }),
      });
      const quoteData = await quoteResponse.json().catch(() => ({}));
      const selected = (Array.isArray(quoteData?.ShippingSevicesArray) ? quoteData.ShippingSevicesArray : []).find((item: Record<string, unknown>) => String(item.ServiceCode) === serviceId && item.Error !== true);
      if (!quoteResponse.ok || !selected) return respond(origin, { error: "A cotação Frenet selecionada expirou. Consulte o CEP novamente." }, 409);
      carrierQuote = { id: selected.ServiceCode, name: selected.ServiceDescription, company: { name: selected.Carrier }, price: Number(selected.ShippingPrice || 0), custom_price: Number(selected.ShippingPrice || 0), delivery_time: Number(selected.DeliveryTime || 0), custom_delivery_time: Number(selected.DeliveryTime || 0), carrier_code: selected.CarrierCode };
    } else {
    const { data: integration } = await db.from("melhor_envio_integracao").select("access_token").eq("id", "principal").maybeSingle();
    if (!integration?.access_token || carrierDestination.length !== 8) return respond(origin, { error: "Frete inválido. Consulte o CEP novamente." }, 400);
    const meEnvironment = (Deno.env.get("MELHOR_ENVIO_ENVIRONMENT") || "production").toLowerCase();
    const meBase = meEnvironment === "sandbox" ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
    carrierOrigin = String(Deno.env.get("MELHOR_ENVIO_FROM_POSTAL_CODE") || "90650003").replace(/\D/g, "");
    const quoteResponse = await fetch(`${meBase}/api/v2/me/shipment/calculate`, {
      method: "POST",
      headers: { authorization: `Bearer ${integration.access_token}`, accept: "application/json", "content-type": "application/json", "user-agent": "Tio Nan (contato@tionan.com.br)" },
      body: JSON.stringify({ from: { postal_code: carrierOrigin }, to: { postal_code: carrierDestination }, products: [{ id: "garrafa-700ml", width: 12, height: 36, length: 12, weight: 1.5, insurance_value: 55, quantity: totalBottles }], options: { receipt: false, own_hand: false } }),
    });
    const quotes = await quoteResponse.json().catch(() => []);
    const selected = (Array.isArray(quotes) ? quotes : []).find((item) => String(item.id) === serviceId && !item.error);
    if (!quoteResponse.ok || !selected) return respond(origin, { error: "A cotação selecionada expirou. Consulte o CEP novamente." }, 409);
    carrierQuote = selected;
    }
  }
  const shipping = delivery === "tele" ? 15 : carrierDelivery ? money(Number(carrierQuote?.custom_price || carrierQuote?.price || 0)) : 0;
  const shippingDetails = carrierDelivery && carrierQuote ? {
    origem: delivery.startsWith("frenet:") ? "frenet" : "melhor_envio",
    servico_id: String(carrierQuote.id || ""),
    servico: String(carrierQuote.name || "Servico de entrega"),
    transportadora: String((carrierQuote.company as Record<string, unknown> | undefined)?.name || "Transportadora"),
    transportadora_codigo: String(carrierQuote.carrier_code || ""),
    preco: shipping,
    preco_original: money(Number(carrierQuote.price || shipping)),
    prazo_dias_uteis: Number(carrierQuote.custom_delivery_time || carrierQuote.delivery_time || 0),
    cep_origem: carrierOrigin,
    cep_destino: carrierDestination,
    volumes: 1,
    peso_kg: money(totalBottles * 1.5),
    largura_cm: 12,
    altura_cm: 36,
    comprimento_cm: 12,
    quantidade_produtos: totalBottles,
    destinatario: {
      nome: name,
      email,
      telefone: phone,
      documento: cpf,
      endereco: String(payload?.endereco?.rua || "").trim(),
      numero: String(payload?.endereco?.numero || "").trim(),
      complemento: String(payload?.endereco?.complemento || payload?.endereco?.apto || "").trim(),
      bairro: String(payload?.endereco?.bairro || "").trim(),
      cidade: String(payload?.endereco?.cidade || "").trim(),
      uf: String(payload?.endereco?.estado || "").trim().toUpperCase().slice(0, 2),
      cep: carrierDestination,
    },
    cotado_em: new Date().toISOString(),
  } : delivery === "tele" ? {
    origem: "entrega_local",
    servico: "Entrega local",
    transportadora: "Tio Nan",
    preco: shipping,
    prazo_dias_uteis: 5,
    cep_destino: String(payload?.endereco?.cep || "").replace(/\D/g, ""),
  } : {
    origem: "retirada",
    servico: "Retirada na loja",
    transportadora: null,
    preco: 0,
    prazo_dias_uteis: 0,
  };
  let coupon = String(payload?.cupom || "").trim().toUpperCase();
  let discountPercent = 0;
  if (coupon) {
    const { data: couponRow } = await db.from("cupons").select("desconto_percentual,ativo").eq("codigo", coupon).maybeSingle();
    if (couponRow?.ativo) discountPercent = Math.min(100, Math.max(0, Number(couponRow.desconto_percentual || 0)));
    else if (coupon === "AVALIEI20") discountPercent = 20;
    else coupon = "";
  }

  if (coupon) {
    const { data: previous } = await db.from("pedidos").select("id").ilike("cliente", `%${phone}%`).ilike("itens", `%[CUPOM: ${coupon}]%`).limit(1);
    if (previous?.length) return respond(origin, { error: "Este cupom já foi utilizado por este telefone." }, 409);
  }

  const discount = money(subtotal * discountPercent / 100);
  const total = money(subtotal - discount + shipping);
  const reference = crypto.randomUUID();
  const trackingToken = crypto.randomUUID();
  const address = (delivery === "tele" || carrierDelivery)
    ? `${payload?.endereco?.rua || ""}, ${payload?.endereco?.numero || ""} - ${payload?.endereco?.bairro || ""}, ${payload?.endereco?.cidade || ""}/${payload?.endereco?.estado || ""}`
    : "Retirada na Loja (Av. Bento Gonçalves, 4321) - Dia e horário a combinar";
  const clientPayload: Record<string, unknown> = { telefone: phone, nome: name, email, cpf };
  if (delivery === "tele" || carrierDelivery) {
    Object.assign(clientPayload, {
      rua: String(payload?.endereco?.rua || "").trim(),
      numero: String(payload?.endereco?.numero || "").trim(),
      complemento: String(payload?.endereco?.complemento || payload?.endereco?.apto || "").trim(),
      bairro: String(payload?.endereco?.bairro || "").trim(),
      cep: String(payload?.endereco?.cep || "").replace(/\D/g, "").slice(0, 8),
      cidade: String(payload?.endereco?.cidade || "").trim(),
      estado: String(payload?.endereco?.estado || "").trim().toUpperCase().slice(0, 2),
    });
  }
  const saveClient = async () => {
    // CPF é a identidade estável do cliente. Telefone e e-mail podem mudar
    // entre compras e não devem gerar um segundo contato.
    let existingClientId: string | null = null;
    const byCpf = await db.from("clientes").select("id").eq("cpf", cpf).limit(1).maybeSingle();
    existingClientId = byCpf.data?.id || null;
    if (!existingClientId) {
      const byPhone = await db.from("clientes").select("id").eq("telefone", phone).limit(1).maybeSingle();
      existingClientId = byPhone.data?.id || null;
    }
    if (!existingClientId) {
      const byEmail = await db.from("clientes").select("id").ilike("email", email).limit(1).maybeSingle();
      existingClientId = byEmail.data?.id || null;
    }
    if (existingClientId) return db.from("clientes").update(clientPayload).eq("id", existingClientId);
    return db.from("clientes").insert(clientPayload);
  };
  const itemsText = lines.map((item) => `${item.nome} (x${item.quantidade})`).join(", ") + (coupon ? ` [CUPOM: ${coupon}]` : "");

  const { error: orderError } = await db.from("pedidos").insert({
    referencia: reference,
    cliente: `${name} (${phone})`,
    cliente_nome: name,
    cliente_telefone: phone,
    cliente_email: email,
    cliente_cpf: cpf,
    itens: itemsText,
    itens_json: lines,
    total,
    custo: 0,
    endereco: address,
    frete: shipping,
    frete_detalhes: shippingDetails,
    status: "Novo Pedido",
    status_pagamento: isTest ? "pago_teste" : isCash ? "aguardando" : "pendente",
    tracking_token: trackingToken,
    pagamento: isTest
      ? "Pagamento de teste — sem cobrança"
      : isCash
      ? `Dinheiro${payload?.troco ? ` — troco para R$ ${String(payload.troco).slice(0, 20)}` : " — sem troco"}`
      : sandbox ? "Mercado Pago (Teste)" : "Mercado Pago",
    pagamento_metodo: isTest ? "teste" : isCash ? "dinheiro" : null,
    pagamento_parcelas: isCash || isTest ? 1 : null,
  });
  if (orderError) return respond(origin, { error: "Não foi possível criar o pedido.", detail: orderError.message }, 500);

  const reserveStock = async () => {
    const { error } = await db.rpc("reservar_estoque_pedido", { p_referencia: reference });
    if (error) throw new Error(error.message || "Não foi possível reservar o estoque.");
  };

  if (isCash || isTest) {
    try {
      await reserveStock();
    } catch (stockError) {
      await db.from("pedidos").delete().eq("referencia", reference);
      return respond(origin, { error: stockError instanceof Error ? stockError.message : "Estoque insuficiente." }, 409);
    }
    await saveClient();
    if (!isTest) {
      const emailResult = await sendOrderConfirmation({ email, name, reference, trackingToken });
      if (emailResult.ok) await db.from("pedidos").update({ email_confirmacao_enviado_em: new Date().toISOString() }).eq("referencia", reference);
      else console.error("Falha ao enviar confirmação do pedido", emailResult.error);
    }
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (syncSecret) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
        body: JSON.stringify({ action: "pedido", referencia: reference }),
      }).catch((error) => console.error("Falha ao sincronizar pedido sem cobrança", error));
    }
    return respond(origin, { ok: true, pedido: reference, tracking_token: trackingToken });
  }

  // O Mercado Pago exige URLs públicas HTTPS quando `auto_return` está ativo.
  // O checkout pode ser iniciado no localhost, mas o retorno sempre vai ao site oficial.
  const site = DEFAULT_SITE;
  const functionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercado-pago-webhook`;
  if (sandbox) {
    const rawPayment = payload?.payment || {};
    const paymentMethodId = String(rawPayment.payment_method_id || "");
    if (!paymentMethodId) {
      await db.from("pedidos").update({ status_pagamento: "erro", mercado_pago_status: "missing_payment_method", atualizado_em: new Date().toISOString() }).eq("referencia", reference);
      return respond(origin, { error: "Selecione uma forma de pagamento." }, 400);
    }
    const paymentBody: Record<string, unknown> = {
      transaction_amount: total,
      description: `Pedido Tio Nan — ${lines.map((item) => item.nome).join(", ").slice(0, 180)}`,
      payment_method_id: paymentMethodId,
      external_reference: reference,
      notification_url: `${functionUrl}?sandbox=1`,
      payer: { email, first_name: name, identification: { type: "CPF", number: cpf } },
      metadata: { pedido_referencia: reference, cliente_telefone: phone, sandbox: true },
    };
    if (rawPayment.token) paymentBody.token = String(rawPayment.token);
    if (rawPayment.issuer_id) paymentBody.issuer_id = String(rawPayment.issuer_id);
    if (rawPayment.installments) paymentBody.installments = Math.max(1, Math.trunc(Number(rawPayment.installments)));
    const paymentResponse = await fetch(`${MP_API}/v1/payments`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-idempotency-key": reference },
      body: JSON.stringify(paymentBody),
    });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok || !payment?.id) {
      await db.from("pedidos").update({ status_pagamento: "erro", mercado_pago_status: "payment_error", atualizado_em: new Date().toISOString() }).eq("referencia", reference);
      return respond(origin, { error: "O Mercado Pago recusou o pagamento de teste.", detail: payment?.message || payment?.cause?.[0]?.description || payment?.error }, 502);
    }
    const paymentStatus = String(payment.status || "pending");
    const localStatus = paymentStatus === "approved" ? "pago_teste" : paymentStatus === "rejected" ? "cancelado_teste" : "pendente_teste";
    await db.from("pedidos").update({
      mercado_pago_payment_id: String(payment.id),
      mercado_pago_status: paymentStatus,
      status_pagamento: localStatus,
      pagamento_metodo: String(payment.payment_method_id || paymentMethodId || ""),
      pagamento_parcelas: Math.max(1, Number(payment.installments || rawPayment.installments || 1)),
      atualizado_em: new Date().toISOString(),
    }).eq("referencia", reference);
    await saveClient();
    if (paymentStatus === "approved") {
      try {
        await reserveStock();
      } catch (stockError) {
        await db.from("pedidos").update({ status_pagamento: "divergente", mercado_pago_status: "approved_without_stock" }).eq("referencia", reference);
        return respond(origin, { error: stockError instanceof Error ? stockError.message : "Pagamento aprovado, mas o estoque ficou indisponível." }, 409);
      }
      const emailResult = await sendOrderConfirmation({ email, name, reference, trackingToken });
      if (emailResult.ok) await db.from("pedidos").update({ email_confirmacao_enviado_em: new Date().toISOString() }).eq("referencia", reference);
      else console.error("Falha ao enviar confirmação do pedido", emailResult.error);
    }
    return respond(origin, { ok: true, sandbox: true, pedido: reference, tracking_token: trackingToken, payment_id: String(payment.id), status: paymentStatus, status_detail: payment.status_detail });
  }

  const preferenceResponse = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-idempotency-key": reference },
    body: JSON.stringify({
      items: [{ id: reference, title: `Pedido Tio Nan — ${lines.map((item) => item.nome).join(", ").slice(0, 180)}`, quantity: 1, currency_id: "BRL", unit_price: total }],
      external_reference: reference,
      statement_descriptor: "TIO NAN",
      payer: { name, email, identification: { type: "CPF", number: cpf }, phone: { area_code: phone.slice(0, 2), number: phone.slice(2) } },
      back_urls: {
        success: `${site}/?pagamento=sucesso&pedido=${reference}`,
        pending: `${site}/?pagamento=pendente&pedido=${reference}`,
        failure: `${site}/?pagamento=falha&pedido=${reference}`,
      },
      auto_return: "approved",
      notification_url: functionUrl,
      metadata: { pedido_referencia: reference, cliente_telefone: phone },
    }),
  });
  const preference = await preferenceResponse.json().catch(() => ({}));
  if (!preferenceResponse.ok || !preference?.id || !preference?.init_point) {
    await db.from("pedidos").update({ status_pagamento: "erro", mercado_pago_status: "preference_error", atualizado_em: new Date().toISOString() }).eq("referencia", reference);
    return respond(origin, { error: "O Mercado Pago recusou a abertura do checkout.", detail: preference?.message || preference?.error }, 502);
  }
  await db.from("pedidos").update({ mercado_pago_preference_id: String(preference.id), atualizado_em: new Date().toISOString() }).eq("referencia", reference);
  await saveClient();
  return respond(origin, { ok: true, pedido: reference, tracking_token: trackingToken, checkout_url: preference.init_point });
});

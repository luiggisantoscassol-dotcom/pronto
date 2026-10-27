import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderConfirmation } from "../_shared/order-email.ts";

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" && (
      url.hostname === "tionan.com.br" ||
      url.hostname === "www.tionan.com.br" ||
      url.hostname.endsWith(".vercel.app")
    )) || (url.protocol === "http:" && ["localhost", "127.0.0.1", "192.168.1.36"].includes(url.hostname));
  } catch {
    return false;
  }
};

const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && isAllowedOrigin(origin) ? origin : "https://www.tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});

const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" },
});

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Use POST." }, 405);
  if (!isAllowedOrigin(origin)) return json(origin, { error: "Origem não autorizada." }, 403);

  const authorization = request.headers.get("authorization") || "";
  const userToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!userToken) return json(origin, { error: "Entre novamente no painel administrativo." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: authData, error: authError } = await db.auth.getUser(userToken);
  if (authError || !authData.user) return json(origin, { error: "Sessão administrativa inválida." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (!admin) return json(origin, { error: "Acesso administrativo necessário." }, 403);

  const input = await request.json().catch(() => ({}));
  const pedidoId = String(input.pedido_id || "").trim();
  if (!pedidoId) return json(origin, { error: "Pedido não informado." }, 400);

  const { data: order, error: orderError } = await db.from("pedidos")
    .select("id,referencia,total,mercado_pago_payment_id,status_pagamento,bling_id,cliente_email,cliente_nome,tracking_token,email_confirmacao_enviado_em,estoque_reservado_em,carrinho_recuperacao_token")
    .eq("id", pedidoId)
    .single();
  if (orderError || !order) return json(origin, { error: "Pedido não encontrado." }, 404);

  const paymentId = String(order.mercado_pago_payment_id || "").trim();
  if (!paymentId) return json(origin, { error: "Este pedido não possui identificação de pagamento no Mercado Pago." }, 409);

  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  if (!accessToken) return json(origin, { error: "Credencial do Mercado Pago não configurada." }, 500);
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payment = await paymentResponse.json().catch(() => ({}));
  if (!paymentResponse.ok) return json(origin, { error: "Não foi possível consultar o pagamento no Mercado Pago." }, 502);

  const reference = String(payment.external_reference || payment.metadata?.pedido_referencia || "");
  if (!reference || reference !== String(order.referencia)) {
    return json(origin, { error: "O pagamento consultado não pertence a este pedido." }, 409);
  }

  const status = String(payment.status || "unknown");
  const paidAmount = Number(payment.transaction_amount || 0);
  const expectedAmount = Number(order.total || 0);
  if (status === "approved" && Math.abs(paidAmount - expectedAmount) > 0.01) {
    await db.from("pedidos").update({
      mercado_pago_status: "amount_mismatch",
      status_pagamento: "divergente",
      atualizado_em: new Date().toISOString(),
    }).eq("id", order.id);
    return json(origin, { error: "O valor aprovado diverge do total do pedido. A atualização foi bloqueada." }, 409);
  }

  const localStatus = status === "approved"
    ? "pago"
    : ["rejected", "cancelled", "refunded", "charged_back"].includes(status) ? "cancelado" : "pendente";
  const { error: updateError } = await db.from("pedidos").update({
    mercado_pago_status: status,
    status_pagamento: localStatus,
    pagamento_metodo: String(payment.payment_method_id || ""),
    pagamento_parcelas: Math.max(1, Number(payment.installments || 1)),
    atualizado_em: new Date().toISOString(),
  }).eq("id", order.id);
  if (updateError) return json(origin, { error: updateError.message }, 500);

  if (status !== "approved") {
    return json(origin, { ok: true, status, status_pagamento: localStatus, bling_id: order.bling_id || null });
  }

  if (!order.estoque_reservado_em) {
    const { error: stockError } = await db.rpc("reservar_estoque_pedido", { p_referencia: order.referencia });
    if (stockError) {
      await db.from("pedidos").update({ status_pagamento: "divergente", mercado_pago_status: "approved_without_stock" }).eq("id", order.id);
      return json(origin, { error: stockError.message || "Pagamento aprovado, mas o estoque ficou indisponível." }, 409);
    }
  }

  if (order.carrinho_recuperacao_token) {
    await db.from("carrinhos_abandonados").update({
      status: "convertido",
      convertido_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq("token", order.carrinho_recuperacao_token);
  }

  if (order.cliente_email && order.tracking_token && !order.email_confirmacao_enviado_em) {
    const emailResult = await sendOrderConfirmation({
      email: order.cliente_email,
      name: order.cliente_nome || "Cliente Tio Nan",
      reference: order.referencia,
      trackingToken: String(order.tracking_token),
    });
    if (emailResult.ok) {
      await db.from("pedidos").update({ email_confirmacao_enviado_em: new Date().toISOString() }).eq("id", order.id);
    } else {
      console.error("Falha ao enviar confirmação do pedido reconciliado", emailResult.error);
    }
  }

  let blingId = order.bling_id ? String(order.bling_id) : "";
  let blingError = "";
  if (!blingId) {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) {
      blingError = "Segredo de sincronização do Bling não configurado.";
    } else {
      const syncResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
        body: JSON.stringify({ action: "pedido", referencia: order.referencia }),
      });
      const syncResult = await syncResponse.json().catch(() => ({}));
      blingId = String(syncResult?.bling_id || "");
      if (!syncResponse.ok || !syncResult?.ok) blingError = String(syncResult?.error || "Falha ao sincronizar o pedido com o Bling.");
    }
  }

  return json(origin, {
    ok: true,
    status,
    status_pagamento: "pago",
    bling_id: blingId || null,
    bling_erro: blingError || null,
  });
});

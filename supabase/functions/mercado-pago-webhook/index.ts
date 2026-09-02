import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderConfirmation } from "../_shared/order-email.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function validSignature(request: Request, paymentId: string) {
  const secret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET");
  if (!secret) return true; // A consulta autenticada do pagamento continua sendo a fonte de verdade.
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const parts = Object.fromEntries(signature.split(",").map((part) => part.split("=").map((value) => value.trim())));
  if (!parts.ts || !parts.v1 || !requestId) return false;
  const manifest = `id:${paymentId};request-id:${requestId};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest))) === parts.v1;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: true });
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const paymentId = String(body?.data?.id || url.searchParams.get("data.id") || "");
  const type = String(body?.type || url.searchParams.get("type") || "");
  if (!paymentId || (type && type !== "payment")) return json({ ok: true, ignored: true });
  if (!(await validSignature(request, paymentId))) return json({ error: "Assinatura inválida." }, 401);

  const sandbox = url.searchParams.get("sandbox") === "1";
  const accessToken = Deno.env.get(sandbox ? "MERCADO_PAGO_TEST_ACCESS_TOKEN" : "MERCADO_PAGO_ACCESS_TOKEN");
  if (!accessToken) return json({ error: "Credencial ausente." }, 500);
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payment = await paymentResponse.json().catch(() => ({}));
  if (!paymentResponse.ok) return json({ error: "Pagamento não encontrado." }, 404);

  const reference = String(payment.external_reference || payment.metadata?.pedido_referencia || "");
  if (!reference) return json({ ok: true, ignored: true });
  const status = String(payment.status || "unknown");
  const paymentMethod = String(payment.payment_method_id || "");
  const installments = Math.max(1, Number(payment.installments || 1));
  const localStatus = sandbox
    ? status === "approved" ? "pago_teste" : ["rejected", "cancelled", "refunded", "charged_back"].includes(status) ? "cancelado_teste" : "pendente_teste"
    : status === "approved" ? "pago" : ["rejected", "cancelled", "refunded", "charged_back"].includes(status) ? "cancelado" : "pendente";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: existingOrder } = await db.from("pedidos")
    .select("referencia,total,bling_id,cliente_email,cliente_nome,tracking_token,email_confirmacao_enviado_em")
    .eq("referencia", reference)
    .maybeSingle();
  if (!existingOrder) return json({ ok: true, ignored: true });
  const paidAmount = Number(payment.transaction_amount || 0);
  const expectedAmount = Number(existingOrder.total || 0);
  if (status === "approved" && Math.abs(paidAmount - expectedAmount) > 0.01) {
    await db.from("pedidos").update({
      mercado_pago_payment_id: paymentId,
      mercado_pago_status: "amount_mismatch",
      status_pagamento: "divergente",
      atualizado_em: new Date().toISOString(),
    }).eq("referencia", reference);
    return json({ error: "Valor do pagamento divergente." }, 409);
  }

  const { data: order, error } = await db.from("pedidos").update({
    mercado_pago_payment_id: paymentId,
    mercado_pago_status: status,
    status_pagamento: localStatus,
    pagamento_metodo: paymentMethod,
    pagamento_parcelas: installments,
    atualizado_em: new Date().toISOString(),
  }).eq("referencia", reference).select("referencia,bling_id").maybeSingle();
  if (error) return json({ error: error.message }, 500);

  if (status === "approved" && existingOrder.cliente_email && existingOrder.tracking_token && !existingOrder.email_confirmacao_enviado_em) {
    const emailResult = await sendOrderConfirmation({
      email: existingOrder.cliente_email,
      name: existingOrder.cliente_nome || "Cliente Tio Nan",
      reference,
      trackingToken: String(existingOrder.tracking_token),
    });
    if (emailResult.ok) await db.from("pedidos").update({ email_confirmacao_enviado_em: new Date().toISOString() }).eq("referencia", reference);
    else console.error("Falha ao enviar confirmação do pedido", emailResult.error);
  }

  if (!sandbox && status === "approved" && order && !order.bling_id) {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (syncSecret) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
        body: JSON.stringify({ action: "pedido", referencia: reference }),
      }).catch((syncError) => console.error("Falha ao acionar Bling", syncError));
    }
  }
  return json({ ok: true });
});

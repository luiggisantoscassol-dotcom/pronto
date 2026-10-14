import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://www.tionan.com.br", "https://tionan.com.br", "http://localhost:8000", "http://127.0.0.1:8000", "http://192.168.0.103:8000", "http://192.168.2.110:8080", "http://172.20.10.3:8000"]);
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "Origin",
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" } });

const addBusinessDays = (start: string, amount: number) => {
  const date = new Date(start);
  date.setUTCHours(12, 0, 0, 0);
  let remaining = Math.max(1, Math.min(60, Math.ceil(amount)));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
};

const estimatedDeliveryDate = (order: Record<string, unknown>) => {
  const freight = String(order.frete || "").toLowerCase();
  const details = order.frete_detalhes && typeof order.frete_detalhes === "object"
    ? order.frete_detalhes as Record<string, unknown>
    : {};
  const quotedDays = Number(details.prazo_dias_uteis ?? details.prazo ?? 0);
  const isCarrier = freight.includes("melhor_envio") || freight.includes("frenet") || quotedDays > 0;
  const days = isCarrier && Number.isFinite(quotedDays) && quotedDays > 0
    ? quotedDays + 2
    : freight.includes("retirada") ? 1 : 3;
  return addBusinessDays(String(order.created_at || new Date().toISOString()), days);
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Use POST." }, 405);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: "Origem não autorizada." }, 403);
  const body = await request.json().catch(() => null);
  const token = String(body?.token || "");
  const code = String(body?.codigo || "").trim().toLowerCase();
  const validToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
  const validCode = /^[0-9a-f]{8}$/i.test(code);
  if (!validToken && !validCode) return json(origin, { error: "Código inválido." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let query = db.from("pedidos").select("referencia,status,status_pagamento,total,itens_json,created_at,atualizado_em,cliente_email,frete,frete_detalhes,pagamento");
  query = validToken ? query.eq("tracking_token", token) : query.ilike("referencia", `${code}%`);
  const { data, error } = await query.limit(2);
  if (error) return json(origin, { error: "Não foi possível consultar o pedido." }, 500);
  if (!data?.length) return json(origin, { error: "Pedido não encontrado." }, 404);
  if (data.length > 1) return json(origin, { error: "Código ambíguo. Use o link completo recebido por e-mail." }, 409);
  const order = data[0] as Record<string, unknown>;
  const publicOrder = {
    referencia: order.referencia,
    status: order.status,
    status_pagamento: order.status_pagamento,
    total: order.total,
    itens_json: order.itens_json,
    created_at: order.created_at,
    atualizado_em: order.atualizado_em,
  };
  const email = String(order.cliente_email || "").trim().toLowerCase();
  const paymentState = `${order.pagamento || ""} ${order.status_pagamento || ""}`.toLowerCase();
  const reviewEligible = validToken
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !/(teste|cancel|erro|falha|divergente)/.test(paymentState);
  return json(origin, {
    pedido: publicOrder,
    google_customer_reviews: reviewEligible ? {
      order_id: String(order.referencia),
      email,
      delivery_country: "BR",
      estimated_delivery_date: estimatedDeliveryDate(order),
    } : null,
  });
});

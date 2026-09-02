import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderStatusUpdate } from "../_shared/order-email.ts";

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br" || url.hostname.endsWith(".vercel.app"))
      || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
};
const cors = (origin: string | null) => ({ "access-control-allow-origin": origin && isAllowedOrigin(origin) ? origin : "https://www.tionan.com.br", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" });
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" } });
const VALID_STATUSES = new Set(["Novo Pedido", "Confirmado", "Em Preparo", "Saiu para Entrega", "Concluído", "Cancelado"]);

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Use POST." }, 405);
  if (!isAllowedOrigin(origin)) return json(origin, { error: "Origem não autorizada." }, 403);

  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(origin, { error: "Sessão não enviada. Entre novamente no painel." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: authData, error: authError } = await db.auth.getUser(accessToken);
  if (authError || !authData.user) return json(origin, { error: "Acesso administrativo necessário." }, 401);

  // A consulta administrativa usa service_role apenas para confirmar o ID do
  // usuário autenticado. Isso evita incompatibilidades do RPC is_admin com o
  // JWT da sessão, sem abrir a função para usuários comuns.
  const { data: admin, error: adminError } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (adminError || !admin) return json(origin, { error: "Usuário não autorizado como administrador." }, 403);

  const input = await request.json().catch(() => ({}));
  if (input.action === "sincronizar_produtos_bling") {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
      body: JSON.stringify({ action: "produtos" }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json(origin, { error: result?.error || "Falha ao sincronizar os produtos no Bling." }, response.status);
    return json(origin, { ok: true, total: Number(result?.total || 0) });
  }

  if (input.action === "sincronizar_contato_bling") {
    const referencia = String(input.referencia || "");
    if (!referencia) return json(origin, { error: "Referência do pedido não informada." }, 400);
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
      body: JSON.stringify({ action: "pedido", referencia }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json(origin, { error: result?.error || "Falha ao sincronizar o contato no Bling." }, response.status);
    return json(origin, { ok: true, contato_atualizado: Boolean(result?.contato_atualizado), bling_id: result?.bling_id });
  }

  const pedidoId = String(input.pedido_id || "");
  const status = String(input.status || "");
  if (!pedidoId || !VALID_STATUSES.has(status)) return json(origin, { error: "Pedido ou status inválido." }, 400);

  const { data: order, error: orderError } = await db.from("pedidos").select("id,referencia,status,cliente_email,cliente_nome,tracking_token").eq("id", pedidoId).single();
  if (orderError || !order) return json(origin, { error: "Pedido não encontrado." }, 404);
  const { error: updateError } = await db.from("pedidos").update({ status, atualizado_em: new Date().toISOString() }).eq("id", pedidoId);
  if (updateError) return json(origin, { error: "Não foi possível atualizar o pedido." }, 500);

  let emailEnviado = false;
  let emailErro: string | null = null;
  if (order.status !== status && order.cliente_email && order.tracking_token) {
    const result = await sendOrderStatusUpdate({ email: order.cliente_email, name: order.cliente_nome || "Cliente Tio Nan", reference: order.referencia, trackingToken: String(order.tracking_token), status });
    emailEnviado = Boolean(result.ok);
    if (!result.ok && !result.skipped) emailErro = result.error || "Falha no envio";
  }
  return json(origin, { ok: true, status, email_enviado: emailEnviado, email_erro: emailErro });
});

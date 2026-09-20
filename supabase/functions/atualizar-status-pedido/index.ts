import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderStatusUpdate } from "../_shared/order-email.ts";

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br" || url.hostname.endsWith(".vercel.app"))
      || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "192.168.1.36"));
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
  if (input.action === "estornar_envase_completo") {
    const envaseId = String(input.envase_id || "");
    const motivo = String(input.motivo || "").trim();
    if (!envaseId || motivo.length < 3) return json(origin, { error: "Informe o envase e o motivo do estorno." }, 400);
    const { data: batch, error: batchError } = await db.from("envases").select("id,produto_bling_id,produto_nome,deposito_bling_id,garrafas,bling_status,estornado_em,lote").eq("id", envaseId).single();
    if (batchError || !batch) return json(origin, { error: "Envase não encontrado." }, 404);
    if (batch.estornado_em) return json(origin, { error: "Este envase já foi estornado." }, 409);
    if (batch.bling_status !== "sincronizado") return json(origin, { error: "Este envase não entrou no Bling. Corrija a sincronização antes do estorno." }, 409);
    const { data: product } = await db.from("produtos").select("estoque").eq("bling_id", batch.produto_bling_id).maybeSingle();
    if (Number(product?.estoque || 0) < Number(batch.garrafas || 0)) {
      return json(origin, { error: `Não é possível estornar ${batch.garrafas} garrafas: o saldo disponível de ${batch.produto_nome} é ${Number(product?.estoque || 0)}. Parte deste lote pode já ter sido vendida.` }, 409);
    }
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const callStock = async (action: "entrada_estoque" | "saida_estoque") => {
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, { method: "POST", headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret }, body: JSON.stringify({ action, produto_bling_id: batch.produto_bling_id, deposito_bling_id: batch.deposito_bling_id, quantidade: batch.garrafas, observacoes: `${action === "saida_estoque" ? "Estorno" : "Compensação"} do envase lote ${batch.lote}: ${motivo}` }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "O Bling recusou a movimentação de estoque.");
      return result;
    };
    let saida;
    try { saida = await callStock("saida_estoque"); }
    catch (error) { return json(origin, { error: error instanceof Error ? error.message : "Falha ao retirar as garrafas do Bling." }, 422); }
    const { data: estorno, error: estornoError } = await db.rpc("estornar_envase", { p_envase: envaseId, p_motivo: motivo });
    if (estornoError) {
      try { await callStock("entrada_estoque"); } catch { /* requer conferência manual somente se a compensação também falhar */ }
      return json(origin, { error: `A saída foi compensada porque o estorno interno falhou: ${estornoError.message}` }, 422);
    }
    return json(origin, { ok: true, envase: estorno, saldo_fisico: saida?.saldo_fisico });
  }
  if (input.action === "reconciliar_pedidos_bling") {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, { method: "POST", headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret }, body: JSON.stringify({ action: "reconciliar_pedidos" }) });
    const result = await response.json().catch(() => ({}));
    return json(origin, response.ok ? result : { error: result?.error || "Falha ao conciliar pedidos." }, response.status);
  }
  if (["listar_depositos_bling", "entrada_estoque_bling", "saida_estoque_bling", "zerar_estoque_deposito_bling"].includes(input.action)) {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const payload = input.action === "listar_depositos_bling"
      ? { action: "depositos" }
      : input.action === "zerar_estoque_deposito_bling"
        ? { action: "zerar_estoque_deposito", deposito_bling_id: input.deposito_bling_id }
        : { action: input.action === "saida_estoque_bling" ? "saida_estoque" : "entrada_estoque", produto_bling_id: input.produto_bling_id, deposito_bling_id: input.deposito_bling_id, quantidade: input.quantidade, envase_id: input.envase_id, consignacao_id: input.consignacao_id, observacoes: input.observacoes };
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
      method: "POST", headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret }, body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    return json(origin, response.ok ? result : { error: result?.error || "Falha na comunicação com o Bling." }, response.status);
  }
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

  if (input.action === "criar_produto_bling") {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
      body: JSON.stringify({ action: "criar_produto", produto: input.produto }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json(origin, { error: result?.error || "Falha ao cadastrar o produto no Bling." }, response.status);
    return json(origin, result);
  }

  if (input.action === "atualizar_produto_bling") {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
      body: JSON.stringify({ action: "atualizar_produto", produto: input.produto }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json(origin, { error: result?.error || "Falha ao atualizar o produto no Bling." }, response.status);
    return json(origin, result);
  }

  if (input.action === "atualizar_cliente_bling") {
    const clienteId = String(input.cliente_id || "");
    if (!clienteId) return json(origin, { error: "Cliente não informado." }, 400);
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret) return json(origin, { error: "Integração do Bling não configurada." }, 500);
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bling-sync-secret": syncSecret },
      body: JSON.stringify({ action: "atualizar_cliente", cliente_id: clienteId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json(origin, { error: result?.error || "Falha ao atualizar o cliente no Bling." }, response.status);
    return json(origin, result);
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

  if (input.action === "sincronizar_pedido_bling") {
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
    if (!response.ok) return json(origin, { error: result?.error || "Falha ao sincronizar o pedido no Bling." }, response.status);
    return json(origin, { ok: true, bling_id: result?.bling_id, estoque_bling: Boolean(result?.estoque_bling) });
  }

  if (input.action === "cancelar_pedido_local") {
    const pedidoId = String(input.pedido_id || "");
    const motivo = String(input.motivo || "").trim();
    if (!pedidoId || motivo.length < 5) return json(origin, { error: "Informe o pedido e um motivo com pelo menos 5 caracteres." }, 400);
    const { data: order, error: orderError } = await db.from("pedidos").select("id,referencia,status,bling_id,estoque_estornado_em,cliente_email,cliente_nome,tracking_token").eq("id", pedidoId).single();
    if (orderError || !order) return json(origin, { error: "Pedido não encontrado." }, 404);
    if (order.bling_id) return json(origin, { error: "Este pedido está no Bling e deve usar o cancelamento fiscal integrado." }, 409);
    if (!order.estoque_estornado_em) {
      const { error: stockError } = await db.rpc("estornar_estoque_pedido_cancelado", { p_pedido: pedidoId });
      if (stockError) return json(origin, { error: stockError.message }, 422);
    }
    const { error: packageError } = await db.rpc("estornar_embalagem_pdv", { p_pedido_id: pedidoId });
    if (packageError) return json(origin, { error: `Garrafas estornadas, mas a embalagem não foi devolvida: ${packageError.message}` }, 422);
    const now = new Date().toISOString();
    const { error: updateError } = await db.from("pedidos").update({ status: "Cancelado", cancelado_em: now, cancelado_por: authData.user.id, motivo_cancelamento: motivo, atualizado_em: now }).eq("id", pedidoId);
    if (updateError) return json(origin, { error: "Não foi possível marcar o pedido como cancelado." }, 500);
    let emailEnviado = false;
    let emailErro: string | null = null;
    if (order.cliente_email && order.tracking_token) {
      const emailResult = await sendOrderStatusUpdate({ email: order.cliente_email, name: order.cliente_nome || "Cliente Tio Nan", reference: order.referencia, trackingToken: String(order.tracking_token), status: "Cancelado", reason: motivo });
      emailEnviado = Boolean(emailResult.ok);
      if (!emailResult.ok && !emailResult.skipped) emailErro = emailResult.error || "Falha no envio";
    }
    return json(origin, { ok: true, estoque_estornado: true, email_enviado: emailEnviado, email_erro: emailErro });
  }

  const pedidoId = String(input.pedido_id || "");
  const status = String(input.status || "");
  if (!pedidoId || !VALID_STATUSES.has(status)) return json(origin, { error: "Pedido ou status inválido." }, 400);

  const { data: order, error: orderError } = await db.from("pedidos").select("id,referencia,status,cliente_email,cliente_nome,tracking_token").eq("id", pedidoId).single();
  if (orderError || !order) return json(origin, { error: "Pedido não encontrado." }, 404);
  const now = new Date().toISOString();
  const statusUpdate: Record<string, unknown> = { status, atualizado_em: now };
  if (status === "Concluído" && order.status !== "Concluído") statusUpdate.concluido_em = now;
  const { error: updateError } = await db.from("pedidos").update(statusUpdate).eq("id", pedidoId);
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://www.tionan.com.br", "https://tionan.com.br", "http://localhost:8000", "http://127.0.0.1:8000", "http://192.168.2.110:8080"]);
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "Origin",
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" } });

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
  let query = db.from("pedidos").select("referencia,status,status_pagamento,created_at,atualizado_em");
  query = validToken ? query.eq("tracking_token", token) : query.ilike("referencia", `${code}%`);
  const { data, error } = await query.limit(2);
  if (error) return json(origin, { error: "Não foi possível consultar o pedido." }, 500);
  if (!data?.length) return json(origin, { error: "Pedido não encontrado." }, 404);
  if (data.length > 1) return json(origin, { error: "Código ambíguo. Use o link completo recebido por e-mail." }, 409);
  return json(origin, { pedido: data[0] });
});

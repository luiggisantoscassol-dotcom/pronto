import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_SITE = "https://www.tionan.com.br";
const allowed = (origin: string | null) => !origin || ["https://www.tionan.com.br", "https://tionan.com.br"].includes(origin)
  || /^https:\/\/[^/]+\.vercel\.app$/.test(origin)
  || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && allowed(origin) ? origin : DEFAULT_SITE,
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
  vary: "Origin",
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" },
});
const validCpf = (value: string) => {
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
const normalize = (value = "") => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^cachaca\s+(de\s+)?/, "").trim();
const money = (value: number) => Number(value.toFixed(2));

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error:"Use POST." }, 405);
  if (!allowed(origin)) return json(origin, { error:"Origem não autorizada." }, 403);
  const input = await request.json().catch(() => ({}));
  const cpf = String(input?.cpf || "").replace(/\D/g, "");
  const email = String(input?.email || "").trim().toLowerCase();
  const incoming = Array.isArray(input?.itens) ? input.itens.slice(0, 20) : [];
  if (!validCpf(cpf) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !incoming.length) return json(origin, { error:"Dados incompletos." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: previous, error: previousError } = await db.from("pedidos")
    .select("id")
    .eq("cliente_cpf", cpf)
    .or("status_pagamento.in.(pago,aprovado,approved),status.in.(Concluído,Entregue,Enviado)")
    .limit(1);
  if (previousError) return json(origin, { error:"Não foi possível verificar compras anteriores." }, 500);
  if (previous?.length) return json(origin, { elegivel:false, desconto:0, subtotal_elegivel:0 });

  const { data: products, error: productsError } = await db.from("produtos")
    .select("id,nome,preco,preco_original,tipo_produto,excluido")
    .eq("excluido", false);
  if (productsError) return json(origin, { error:"Não foi possível validar os produtos." }, 500);

  let eligibleSubtotal = 0;
  for (const raw of incoming) {
    const id = String(raw?.id || "");
    const name = normalize(String(raw?.nome || raw?.name || ""));
    const quantity = Math.max(1, Math.min(12, Math.trunc(Number(raw?.quantidade || raw?.qtd || 1))));
    const product = (products || []).find(item => String(item.id) === id || normalize(String(item.nome || "")) === name);
    if (!product || product.tipo_produto === "kit") continue;
    const price = Number(product.preco || 0);
    const original = Number(product.preco_original || 0);
    if (!(price > 0) || original > price) continue;
    eligibleSubtotal += price * quantity;
  }
  eligibleSubtotal = money(eligibleSubtotal);
  return json(origin, { elegivel:true, subtotal_elegivel:eligibleSubtotal, desconto:money(eligibleSubtotal * .2), percentual:20 });
});

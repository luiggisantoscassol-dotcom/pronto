import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROD = "https://melhorenvio.com.br";
const SANDBOX = "https://sandbox.melhorenvio.com.br";
const isAllowedOrigin = (origin: string) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && (url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br" || url.hostname.endsWith(".vercel.app"))) return true;
    if (url.protocol !== "http:") return false;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    const parts = url.hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  } catch {
    return false;
  }
};
const cors = (origin: string) => ({
  "access-control-allow-origin": isAllowedOrigin(origin) ? (origin || "https://tionan.com.br") : "https://tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const json = (origin: string, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Método inválido." }, 405);

  const body = await request.json().catch(() => ({}));
  const destination = String(body?.cep || "").replace(/\D/g, "");
  const quantity = Math.max(1, Math.min(30, Number(body?.quantidade || 1)));
  if (destination.length !== 8) return json(origin, { error: "CEP de destino inválido." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: integration, error } = await db.from("melhor_envio_integracao").select("access_token").eq("id", "principal").maybeSingle();
  if (error || !integration?.access_token) return json(origin, { error: "Melhor Envio não conectado. Reconecte a conta." }, 503);

  const environment = (Deno.env.get("MELHOR_ENVIO_ENVIRONMENT") || "production").toLowerCase();
  const base = environment === "sandbox" ? SANDBOX : PROD;
  const from = String(Deno.env.get("MELHOR_ENVIO_FROM_POSTAL_CODE") || "90650003").replace(/\D/g, "");
  const response = await fetch(`${base}/api/v2/me/shipment/calculate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${integration.access_token}`,
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "Tio Nan (contato@tionan.com.br)",
    },
    body: JSON.stringify({
      from: { postal_code: from },
      to: { postal_code: destination },
      products: [{ id: "garrafa-700ml", width: 12, height: 36, length: 12, weight: 1.5, insurance_value: 55, quantity }],
      options: { receipt: false, own_hand: false },
    }),
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) return json(origin, { error: data?.message || "Não foi possível calcular o frete.", detail: data }, response.status);

  const quotes = (Array.isArray(data) ? data : [])
    .filter((item) => !item.error)
    .map((item) => ({
      id: String(item.id),
      nome: String(item.name || "Entrega"),
      transportadora: String(item.company?.name || "Transportadora"),
      preco: Number(item.custom_price || item.price || 0),
      prazo: Number(item.custom_delivery_time || item.delivery_time || 0),
    }))
    .filter((item) => item.preco > 0)
    .sort((a, b) => a.preco - b.preco);
  return json(origin, { cotacoes: quotes, ambiente: environment });
});

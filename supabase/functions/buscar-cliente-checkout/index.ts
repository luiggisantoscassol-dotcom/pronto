import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_SITE = "https://www.tionan.com.br";
const attempts = new Map<string, { count: number; resetAt: number }>();

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br" || url.hostname.endsWith(".vercel.app"))
      || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || (url.hostname === "192.168.0.103" && url.port === "8000")));
  } catch {
    return false;
  }
};

const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && isAllowedOrigin(origin) ? origin : DEFAULT_SITE,
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const respond = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return respond(origin, { encontrado: false }, 405);
  if (!isAllowedOrigin(origin)) return respond(origin, { encontrado: false }, 403);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (!bucket || bucket.resetAt <= now) attempts.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
  else {
    bucket.count += 1;
    if (bucket.count > 8) return respond(origin, { encontrado: false }, 429);
  }

  const input = await request.json().catch(() => ({}));
  const cpf = String(input.cpf || "").replace(/\D/g, "");
  const email = String(input.email || "").trim().toLowerCase();
  if (cpf.length !== 11 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond(origin, { encontrado: false });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await db.from("clientes")
    .select("nome,telefone,rua,numero,complemento,bairro,cep,cidade,estado")
    .eq("cpf", cpf)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (!data) return respond(origin, { encontrado: false });
  return respond(origin, {
    encontrado: true,
    cliente: {
      nome: data.nome || "",
      telefone: data.telefone || "",
      rua: data.rua || "",
      numero: data.numero || "",
      apto: data.complemento || "",
      bairro: data.bairro || "",
      cep: data.cep || "",
      cidade: data.cidade || "",
      estado: data.estado || "",
    },
  });
});

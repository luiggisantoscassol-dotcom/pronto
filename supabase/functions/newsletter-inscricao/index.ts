import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "tionan.com.br" || host === "www.tionan.com.br" ? origin : "https://www.tionan.com.br";
  } catch { return "https://www.tionan.com.br"; }
};
const headers = (request: Request) => ({ "access-control-allow-origin": allowedOrigin(request), "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", "content-type": "application/json; charset=utf-8", vary: "Origin" });
const response = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(request) });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  if (request.method !== "POST") return response(request, { error: "Use POST." }, 405);
  const input = await request.json().catch(() => ({}));
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response(request, { error: "Informe um e-mail válido." }, 400);
  if (input.consentimento !== true) return response(request, { error: "O consentimento é obrigatório." }, 400);
  const origem = String(input.origem || "modal-site").replace(/[^a-z0-9_-]/gi, "").slice(0, 60) || "modal-site";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.from("newsletter_inscritos").upsert({ email, consentimento: true, consentido_em: new Date().toISOString(), origem, atualizado_em: new Date().toISOString() }, { onConflict: "email" });
  if (error) return response(request, { error: "Não foi possível salvar sua inscrição." }, 500);
  return response(request, { ok: true });
});

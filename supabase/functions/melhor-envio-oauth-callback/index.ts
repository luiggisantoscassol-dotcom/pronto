import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CALLBACK = "https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/melhor-envio-oauth-callback";
const PROD = "https://melhorenvio.com.br";
const SANDBOX = "https://sandbox.melhorenvio.com.br";
const enc = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const sign = async (value: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return enc(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))));
};
const html = (title: string, message: string, status = 200) => new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#fffaf1;color:#17253d;padding:48px;max-width:620px;margin:auto"><h1>${title}</h1><p>${message}</p></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });

Deno.serve(async (request) => {
  if (request.method !== "GET") return html("Método inválido", "Abra este endereço no navegador.", 405);
  const clientId = Deno.env.get("MELHOR_ENVIO_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("MELHOR_ENVIO_CLIENT_SECRET") || "";
  const environment = (Deno.env.get("MELHOR_ENVIO_ENVIRONMENT") || "production").toLowerCase();
  const base = environment === "sandbox" ? SANDBOX : PROD;
  if (!clientId || !clientSecret) return html("Configuração incompleta", "Cadastre as credenciais do Melhor Envio nos Secrets do Supabase.", 500);
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "connect") {
    const payload = `${Date.now()}.${crypto.randomUUID()}`;
    const state = `${payload}.${await sign(payload, clientSecret)}`;
    const authorize = new URL(`${base}/oauth/authorize`);
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", CALLBACK);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set(
      "scope",
      "cart-read cart-write shipping-calculate shipping-companies shipping-generate shipping-checkout shipping-print shipping-cancel shipping-tracking",
    );
    authorize.searchParams.set("state", state);
    return Response.redirect(authorize.toString(), 302);
  }
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const parts = state.split(".");
  if (!code || parts.length !== 3) return html("Conexão não iniciada", "Inicie novamente a conexão pelo painel.", 400);
  const payload = `${parts[0]}.${parts[1]}`;
  const age = Date.now() - Number(parts[0]);
  if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000 || await sign(payload, clientSecret) !== parts[2]) return html("Conexão expirada", "Inicie novamente a conexão com o Melhor Envio.", 400);
  const tokenResponse = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Tio Nan (contato@tionan.com.br)" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, redirect_uri: CALLBACK, code }),
  });
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.access_token) return html("Não foi possível conectar", token.message || token.error || "O Melhor Envio recusou a autorização.", 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.from("melhor_envio_integracao").upsert({ id: "principal", access_token: token.access_token, refresh_token: token.refresh_token || null, expires_at: new Date(Date.now() + Number(token.expires_in || 2592000) * 1000).toISOString(), conectado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
  if (error) return html("Autorizado, mas não salvo", error.message, 500);
  return html("Melhor Envio conectado!", "A conta foi vinculada. Volte ao site para testar as cotações da Jadlog e Loggi.");
});

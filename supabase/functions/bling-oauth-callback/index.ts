import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BLING_TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const BLING_AUTHORIZE_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
const FUNCTION_URL = "https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/bling-oauth-callback";

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const signState = async (payload: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
};
const createState = async (secret: string) => {
  const payload = `${Date.now()}.${crypto.randomUUID()}`;
  return `${payload}.${await signState(payload, secret)}`;
};
const validSignedState = async (state: string, secret: string) => {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const age = Date.now() - Number(parts[0]);
  if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000) return false;
  const expected = await signState(payload, secret);
  if (expected.length !== parts[2].length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ parts[2].charCodeAt(index);
  return difference === 0;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function responseHtml(title: string, message: string, status = 200) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui;background:#fffaf1;color:#17253d;padding:48px;max-width:620px;margin:auto"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return responseHtml("Método inválido", "Use este endereço no navegador.", 405);

  const env = Deno.env;
  const supabaseUrl = env.get("SUPABASE_URL")!;
  const serviceRoleKey = env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = env.get("BLING_CLIENT_ID");
  const clientSecret = env.get("BLING_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return responseHtml("Configuração incompleta", "Configure BLING_CLIENT_ID e BLING_CLIENT_SECRET nos segredos da função.", 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  // Acesse ?action=connect para iniciar a conexão, sem expor o segredo do Bling no site.
  if (action === "connect") {
    const state = await createState(clientSecret);

    const authorize = new URL(BLING_AUTHORIZE_URL);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", FUNCTION_URL);
    authorize.searchParams.set("state", state);
    return Response.redirect(authorize.toString(), 302);
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description") || "O Bling recusou a autorização.";
    return responseHtml(
      "Autorização recusada pelo Bling",
      `${description} Entre no Bling com o usuário administrador que criou ou tem acesso ao aplicativo Tio Nan e tente novamente.`,
      403,
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return responseHtml("Conexão não iniciada", "Abra este endereço com ?action=connect para vincular sua conta Bling.", 400);
  if (!(await validSignedState(state, clientSecret))) {
    return responseHtml("Conexão expirada", "Por segurança, inicie novamente a conexão com o Bling.", 400);
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenResponse = await fetch(BLING_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
      "enable-jwt": "1",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok) return responseHtml("Não foi possível conectar", token?.error_description || token?.error || "O Bling recusou a autorização.", 400);

  const expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
  const { error: saveError } = await db.from("bling_integracao").upsert({
    id: "principal",
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: expiresAt,
    oauth_state: null,
    oauth_state_expires_at: null,
    conectado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  });
  if (saveError) return responseHtml("Autorizado, mas não salvo", saveError.message, 500);
  return responseHtml("Bling conectado!", "A conta está vinculada com segurança. Agora volte ao painel para importar produtos e clientes.");
});

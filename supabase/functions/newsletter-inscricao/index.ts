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
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const signEmail = async (email: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email))));
};
const welcomeHtml = (unsubscribeUrl: string) => `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#17304f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border-radius:20px;overflow:hidden"><tr><td style="padding:28px 24px;text-align:center;border-bottom:1px solid #eee7dc"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="170" alt="Tio Nan" style="display:inline-block;max-width:70%;height:auto"></td></tr><tr><td style="padding:34px 28px 12px"><p style="margin:0 0 9px;color:#b68737;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Agora você faz parte</p><h1 style="margin:0;font-family:Georgia,serif;font-size:32px;line-height:1.1;color:#17304f">Um brinde às boas novidades.</h1></td></tr><tr><td style="padding:12px 28px 4px;font-size:16px;line-height:1.65;color:#4f5e73"><p style="margin:0 0 16px">Que bom ter você por aqui! A partir de agora, lançamentos, kits especiais e novidades da Tio Nan podem chegar primeiro no seu e-mail.</p><p style="margin:0">Prometemos escrever só quando houver algo que realmente mereça um brinde. 🥃</p></td></tr><tr><td style="padding:28px;text-align:left"><a href="https://www.tionan.com.br/todos-produtos.html" style="display:inline-block;padding:15px 22px;border-radius:12px;background:#c79a49;color:#102d50;text-decoration:none;font-weight:900">Conhecer a Tio Nan &nbsp;→</a></td></tr><tr><td style="padding:22px 28px;background:#0b284b;color:#cbd6e4;text-align:center;font-size:11px;line-height:1.5">Beba com moderação. Venda proibida para menores de 18 anos.<br><a href="${unsubscribeUrl}" style="display:inline-block;margin-top:10px;color:#efd7a5">Não quero mais receber novidades</a></td></tr></table></td></tr></table></body></html>`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("action") === "unsubscribe") {
    const email = String(requestUrl.searchParams.get("email") || "").trim().toLowerCase();
    const token = String(requestUrl.searchParams.get("token") || "");
    const expected = await signEmail(email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!email || token !== expected) return new Response("Link de descadastro inválido.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    await db.from("newsletter_inscritos").update({ consentimento: false, atualizado_em: new Date().toISOString() }).eq("email", email);
    return new Response("Tudo certo. Você não receberá mais novidades da Tio Nan por e-mail.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (request.method !== "POST") return response(request, { error: "Use POST." }, 405);
  const input = await request.json().catch(() => ({}));
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response(request, { error: "Informe um e-mail válido." }, 400);
  if (input.consentimento !== true) return response(request, { error: "O consentimento é obrigatório." }, 400);
  const origem = String(input.origem || "modal-site").replace(/[^a-z0-9_-]/gi, "").slice(0, 60) || "modal-site";
  const now = new Date().toISOString();
  const { error } = await db.from("newsletter_inscritos").upsert({ email, consentimento: true, consentido_em: now, origem, atualizado_em: now }, { onConflict: "email" });
  if (error) return response(request, { error: "Não foi possível salvar sua inscrição." }, 500);
  const { data: claimed } = await db.from("newsletter_inscritos")
    .update({ boas_vindas_status: "enviando", boas_vindas_erro: null, atualizado_em: now })
    .eq("email", email).is("boas_vindas_enviado_em", null).or("boas_vindas_status.is.null,boas_vindas_status.eq.erro")
    .select("id").maybeSingle();
  if (!claimed) return response(request, { ok: true, boas_vindas: "ja_enviado" });
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM") || "Tio Nan <pedidos@mail.tionan.com.br>";
  try {
    if (!apiKey) throw new Error("RESEND_API_KEY não configurada.");
    const token = await signEmail(email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const unsubscribeUrl = `${requestUrl.origin}${requestUrl.pathname}?action=unsubscribe&email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
    const sent = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [email], subject: "Boas-vindas à Tio Nan 🥃", html: welcomeHtml(unsubscribeUrl) }) });
    const result = await sent.json().catch(() => ({}));
    if (!sent.ok) throw new Error(String(result?.message || result?.error || `Erro Resend (${sent.status})`));
    await db.from("newsletter_inscritos").update({ boas_vindas_status: "enviado", boas_vindas_enviado_em: new Date().toISOString(), boas_vindas_resend_id: result.id || null, boas_vindas_erro: null, atualizado_em: new Date().toISOString() }).eq("id", claimed.id);
    return response(request, { ok: true, boas_vindas: "enviado" });
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    await db.from("newsletter_inscritos").update({ boas_vindas_status: "erro", boas_vindas_erro: message.slice(0, 1000), atualizado_em: new Date().toISOString() }).eq("id", claimed.id);
    console.error("Falha no e-mail de boas-vindas:", message);
    return response(request, { ok: true, boas_vindas: "pendente" });
  }
});

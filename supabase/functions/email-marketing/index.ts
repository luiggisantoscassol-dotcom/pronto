import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API = "https://api.resend.com";
const allowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  try {
    const url = new URL(origin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
    const site = url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br";
    return local || site ? origin : "https://www.tionan.com.br";
  } catch { return "https://www.tionan.com.br"; }
};
const corsHeaders = (request: Request) => ({
  "access-control-allow-origin": allowedOrigin(request),
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "Origin",
});
const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
});
const escapeHtml = (value: unknown) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char] || char));
const validEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const safeUrl = (value: unknown) => {
  const text = String(value || "").trim();
  if (!text) return "";
  try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
};

const template = (input: Record<string, unknown>, includeUnsubscribe: boolean) => {
  const image = safeUrl(input.imagem_url);
  const buttonUrl = safeUrl(input.botao_url);
  const paragraphs = escapeHtml(input.conteudo).split(/\n{2,}/).map((part) => `<p style="margin:0 0 18px">${part.replace(/\n/g, "<br>")}</p>`).join("");
  const allowed = ["imagem", "titulo", "texto", "botao"];
  const requested = Array.isArray(input.ordem_blocos) ? input.ordem_blocos.map(String).filter((item) => allowed.includes(item)) : [];
  const order = [...new Set([...requested, ...allowed])];
  const blocks: Record<string, string> = {
    imagem: image ? `<tr><td><img src="${image}" alt="" width="620" style="display:block;width:100%;height:auto"></td></tr>` : "",
    titulo: `<tr><td style="padding:34px 32px 0"><p style="margin:0 0 8px;color:#b68737;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Um brinde da Tio Nan</p><h1 style="margin:0;font-family:Georgia,serif;font-size:34px;line-height:1.08;color:#0b284b">${escapeHtml(input.nome)}</h1></td></tr>`,
    texto: `<tr><td style="padding:24px 32px 0"><div style="font-size:17px;line-height:1.65;color:#40516a">${paragraphs}</div></td></tr>`,
    botao: buttonUrl && input.botao_texto ? `<tr><td style="padding:10px 32px 34px"><a href="${buttonUrl}" style="display:inline-block;background:#c79a49;color:#0b284b;text-decoration:none;font-weight:900;padding:15px 24px;border-radius:12px">${escapeHtml(input.botao_texto)}</a></td></tr>` : "",
  };
  return `<!doctype html><html><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#17304f"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border-radius:22px;overflow:hidden"><tr><td style="background:#0b284b;color:#fff;text-align:center;padding:24px;font-size:28px;font-weight:900">TIO NAN</td></tr>${order.map((block) => blocks[block]).join("")}<tr><td style="background:#0b284b;color:#cbd6e4;text-align:center;padding:24px;font-size:12px">Beba com moderação. Venda proibida para menores de 18 anos.${includeUnsubscribe ? `<br><br><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#efd7a5">Não quero mais receber novidades</a>` : ""}</td></tr></table></td></tr></table></body></html>`;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json(request, { error: "Faça login novamente no painel." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (!admin) return json(request, { error: "Acesso restrito ao administrador." }, 403);
  const input = await request.json().catch(() => ({}));
  const action = String(input.action || "overview");
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) return json(request, { error: "RESEND_API_KEY não configurada." }, 500);
  const resend = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${RESEND_API}${path}`, { ...init, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.message || data?.error || `Erro Resend (${response.status})`));
    return data;
  };
  if (action === "overview") {
    const [{ count }, { data: campaigns }] = await Promise.all([
      db.from("clientes").select("id", { count: "exact", head: true }).eq("marketing_consentimento", true).not("email", "is", null),
      db.from("email_campanhas").select("id,nome,assunto,status,destinatarios,enviado_em,criado_em,erro").order("criado_em", { ascending: false }).limit(30),
    ]);
    return json(request, { ok: true, inscritos: count || 0, campanhas: campaigns || [] });
  }
  const campaign = {
    nome: String(input.nome || "").trim(), assunto: String(input.assunto || "").trim(), preheader: String(input.preheader || "").trim(),
    conteudo: String(input.conteudo || "").trim(), imagem_url: safeUrl(input.imagem_url), botao_texto: String(input.botao_texto || "").trim(), botao_url: safeUrl(input.botao_url),
    ordem_blocos: Array.isArray(input.ordem_blocos) ? input.ordem_blocos.map(String).filter((item) => ["imagem", "titulo", "texto", "botao"].includes(item)) : ["imagem", "titulo", "texto", "botao"],
  };
  if (campaign.nome.length < 3 || campaign.assunto.length < 3 || campaign.conteudo.length < 10) return json(request, { error: "Preencha nome, assunto e conteúdo da campanha." }, 400);
  const from = Deno.env.get("RESEND_FROM") || "Tio Nan <pedidos@tionan.com.br>";
  if (action === "test") {
    const to = String(input.email_teste || auth.user.email || "").trim();
    if (!validEmail(to)) return json(request, { error: "Informe um e-mail válido para o teste." }, 400);
    const result = await resend("/emails", { method: "POST", body: JSON.stringify({ from, to: [to], subject: `[TESTE] ${campaign.assunto}`, html: template(campaign, false) }) });
    return json(request, { ok: true, id: result.id });
  }
  if (action !== "send") return json(request, { error: "Ação inválida." }, 400);
  const { data: contacts, error: contactsError } = await db.from("clientes").select("nome,email").eq("marketing_consentimento", true).not("email", "is", null);
  if (contactsError) return json(request, { error: contactsError.message }, 500);
  const subscribers = (contacts || []).filter((item) => validEmail(item.email));
  if (!subscribers.length) return json(request, { error: "Nenhum cliente autorizou e-mail marketing." }, 409);
  const { data: saved, error: saveError } = await db.from("email_campanhas").insert({ ...campaign, status: "enviando", destinatarios: subscribers.length, criado_por: auth.user.id }).select("id").single();
  if (saveError) return json(request, { error: saveError.message }, 500);
  try {
    const segment = await resend("/segments", { method: "POST", body: JSON.stringify({ name: `Tio Nan - ${campaign.nome.slice(0, 35)} - ${new Date().toISOString().slice(0, 10)}` }) });
    for (let index = 0; index < subscribers.length; index += 10) {
      await Promise.all(subscribers.slice(index, index + 10).map(async (contact) => {
        const names = String(contact.nome || "").trim().split(/\s+/);
        const create = await fetch(`${RESEND_API}/contacts`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ email: contact.email, first_name: names[0] || "Cliente", last_name: names.slice(1).join(" "), unsubscribed: false, segments: [{ id: segment.id }] }) });
        if (create.ok) return;
        const add = await fetch(`${RESEND_API}/contacts/${encodeURIComponent(contact.email)}/segments/${segment.id}`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" } });
        if (!add.ok) throw new Error(`Não foi possível incluir ${contact.email} na campanha.`);
      }));
    }
    const broadcast = await resend("/broadcasts", { method: "POST", body: JSON.stringify({ segment_id: segment.id, from, name: campaign.nome, subject: campaign.assunto, html: template(campaign, true), send: true }) });
    await db.from("email_campanhas").update({ status: "enviada", resend_segment_id: segment.id, resend_broadcast_id: broadcast.id, enviado_em: new Date().toISOString() }).eq("id", saved.id);
    return json(request, { ok: true, destinatarios: subscribers.length, broadcast_id: broadcast.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("email_campanhas").update({ status: "erro", erro: message }).eq("id", saved.id);
    return json(request, { error: message }, 502);
  }
});

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
const safeAlign = (value: unknown, fallback = "left") => ["left", "center", "right"].includes(String(value)) ? String(value) : fallback;
const safeColor = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
const safeStyles = (value: unknown) => {
  const styles = value && typeof value === "object" ? value as Record<string, Record<string, unknown>> : {};
  return {
    titulo: { alinhamento: safeAlign(styles.titulo?.alinhamento), cor: safeColor(styles.titulo?.cor, "#17304f"), negrito: styles.titulo?.negrito !== false },
    texto: { alinhamento: safeAlign(styles.texto?.alinhamento), cor: safeColor(styles.texto?.cor, "#40516a"), negrito: styles.texto?.negrito === true },
    botao: { alinhamento: safeAlign(styles.botao?.alinhamento), cor: safeColor(styles.botao?.cor, "#0b284b"), negrito: styles.botao?.negrito !== false },
    logo: { alinhamento: safeAlign(styles.logo?.alinhamento, "center") },
  };
};

type MarketingContact = { nome?: string; email: string };
const SEGMENTS = ["todos", "compradores", "sem_compra", "inativos_60", "gengibre", "ouro", "prata"] as const;
const safeSegment = (value: unknown) => SEGMENTS.includes(String(value) as typeof SEGMENTS[number]) ? String(value) : "todos";
const normalizeText = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const loadAudiences = async (db: ReturnType<typeof createClient>) => {
  const [{ data: customers, error: customerError }, { data: newsletter, error: newsletterError }, { data: orders, error: orderError }] = await Promise.all([
    db.from("clientes").select("nome,email").eq("marketing_consentimento", true).not("email", "is", null),
    db.from("newsletter_inscritos").select("email").eq("consentimento", true),
    db.from("pedidos").select("cliente_email,itens_json,created_at,status").not("cliente_email", "is", null),
  ]);
  if (customerError || newsletterError || orderError) throw new Error(customerError?.message || newsletterError?.message || orderError?.message || "Não foi possível montar os públicos.");
  const authorized = new Map<string, MarketingContact>();
  for (const item of customers || []) {
    const email = String(item.email || "").trim().toLowerCase();
    if (validEmail(email)) authorized.set(email, { nome: String(item.nome || "").trim(), email });
  }
  for (const item of newsletter || []) {
    const email = String(item.email || "").trim().toLowerCase();
    if (validEmail(email) && !authorized.has(email)) authorized.set(email, { email });
  }
  const buyers = new Set<string>();
  const lastPurchase = new Map<string, number>();
  const productText = new Map<string, string>();
  for (const order of orders || []) {
    const email = String(order.cliente_email || "").trim().toLowerCase();
    if (!authorized.has(email) || normalizeText(order.status).startsWith("cancel")) continue;
    buyers.add(email);
    const timestamp = new Date(order.created_at || 0).getTime();
    if (Number.isFinite(timestamp) && timestamp > (lastPurchase.get(email) || 0)) lastPurchase.set(email, timestamp);
    const items = Array.isArray(order.itens_json) ? order.itens_json : [];
    const names = items.map((item: Record<string, unknown>) => normalizeText(item?.nome || item?.name || item?.descricao)).join(" ");
    productText.set(email, `${productText.get(email) || ""} ${names}`.trim());
  }
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const filter = (predicate: (email: string) => boolean) => [...authorized.values()].filter((contact) => predicate(contact.email));
  return {
    todos: [...authorized.values()],
    compradores: filter((email) => buyers.has(email)),
    sem_compra: filter((email) => !buyers.has(email)),
    inativos_60: filter((email) => buyers.has(email) && (lastPurchase.get(email) || 0) < cutoff),
    gengibre: filter((email) => (productText.get(email) || "").includes("gengibre")),
    ouro: filter((email) => /(^|\s)(cachaca\s+)?ouro(\s|$)/.test(productText.get(email) || "")),
    prata: filter((email) => /(^|\s)(cachaca\s+)?prata(\s|$)/.test(productText.get(email) || "")),
  };
};

const template = (input: Record<string, unknown>, includeUnsubscribe: boolean) => {
  const images = Array.isArray(input.imagens_urls) ? input.imagens_urls.map(safeUrl).filter(Boolean) : [safeUrl(input.imagem_url)].filter(Boolean);
  const buttonUrl = safeUrl(input.botao_url);
  const paragraphs = escapeHtml(input.conteudo).split(/\n{2,}/).map((part) => `<p style="margin:0 0 18px">${part.replace(/\n/g, "<br>")}</p>`).join("");
  const styles = safeStyles(input.estilos);
  const imageBlocks = images.map((_, index) => `imagem:${index}`);
  const allowed = ["logo", ...imageBlocks, "titulo", "texto", "botao"];
  const requested = Array.isArray(input.ordem_blocos) ? input.ordem_blocos.map(String).map((item) => item.startsWith("imagem:") ? `imagem:${Math.max(0, Number(item.split(":")[1]) || 0)}` : item).filter((item) => allowed.includes(item)) : [];
  const order = [...new Set([...requested, ...allowed])];
  const blocks: Record<string, string> = {
    logo: `<tr><td class="tn-logo" style="background:#fff;text-align:${styles.logo.alinhamento};padding:30px 32px 26px;border-bottom:1px solid #eee7dc"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="190" alt="Tio Nan" style="display:inline-block;width:190px;max-width:100%;height:auto"></td></tr>`,
    titulo: `<tr><td class="tn-title-pad" style="padding:34px 32px 0;text-align:${styles.titulo.alinhamento}"><p class="tn-eyebrow" style="margin:0 0 8px;color:#b68737;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Um brinde da Tio Nan</p><h1 class="tn-title" style="margin:0;font-family:Georgia,serif;font-size:34px;line-height:1.08;color:${styles.titulo.cor};font-weight:${styles.titulo.negrito ? "800" : "400"}">${escapeHtml(input.nome)}</h1></td></tr>`,
    texto: `<tr><td class="tn-text" style="padding:24px 32px 0;text-align:${styles.texto.alinhamento}"><div style="font-size:17px;line-height:1.65;color:${styles.texto.cor};font-weight:${styles.texto.negrito ? "700" : "400"}">${paragraphs}</div></td></tr>`,
    botao: buttonUrl && input.botao_texto ? `<tr><td class="tn-button-pad" style="padding:14px 32px 38px;text-align:${styles.botao.alinhamento}"><a class="tn-button" href="${buttonUrl}" style="display:inline-block;background:#c79a49;background-image:linear-gradient(135deg,#e1bd70 0%,#b8842f 100%);color:${styles.botao.cor};text-decoration:none;font-weight:${styles.botao.negrito ? "900" : "500"};padding:15px 25px;border:1px solid #9f7126;border-radius:14px;box-shadow:0 8px 18px rgba(116,79,21,.24);letter-spacing:.02em">${escapeHtml(input.botao_texto)} &nbsp;→</a></td></tr>` : "",
  };
  images.forEach((image, index) => { blocks[`imagem:${index}`] = `<tr><td class="tn-image-pad" style="padding:24px 32px 4px"><img src="${image}" alt="" width="556" style="display:block;width:100%;height:auto;border-radius:14px"></td></tr>`; });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:600px){.tn-outer{padding:10px 6px!important}.tn-card{border-radius:14px!important}.tn-title{font-size:25px!important;line-height:1.16!important}.tn-title-pad{padding:26px 20px 0!important}.tn-eyebrow{font-size:10px!important;letter-spacing:1.3px!important}.tn-text{padding:18px 20px 0!important}.tn-text div{font-size:15px!important;line-height:1.55!important}.tn-image-pad{padding:18px 14px 2px!important}.tn-logo{padding:22px 20px 19px!important}.tn-logo img{width:150px!important}.tn-button-pad{padding:22px 20px 28px!important}.tn-button{padding:14px 20px!important}}</style></head><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#17304f"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="tn-outer" style="padding:28px 12px"><table class="tn-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border-radius:22px;overflow:hidden">${order.map((block) => blocks[block]).join("")}<tr><td style="background:#0b284b;color:#cbd6e4;text-align:center;padding:24px;font-size:12px">Beba com moderação. Venda proibida para menores de 18 anos.${includeUnsubscribe ? `<br><br><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#efd7a5">Não quero mais receber novidades</a>` : ""}</td></tr></table></td></tr></table></body></html>`;
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
    try {
      const [audiences, { data: campaigns, error: campaignsError }] = await Promise.all([
        loadAudiences(db),
        db.from("email_campanhas").select("id,nome,assunto,segmento,status,destinatarios,enviado_em,criado_em,erro").order("criado_em", { ascending: false }).limit(30),
      ]);
      if (campaignsError) throw campaignsError;
      const segmentos = Object.fromEntries(Object.entries(audiences).map(([key, contacts]) => [key, contacts.length]));
      return json(request, { ok: true, inscritos: audiences.todos.length, segmentos, campanhas: campaigns || [] });
    } catch (error) {
      return json(request, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
  const subject = String(input.assunto || "").trim();
  const campaign = {
    nome: String(input.nome || subject).trim(), assunto: subject, preheader: String(input.preheader || "").trim(),
    conteudo: String(input.conteudo || "").trim(), imagem_url: safeUrl(input.imagem_url), imagens_urls: Array.isArray(input.imagens_urls) ? input.imagens_urls.map(safeUrl).filter(Boolean) : [safeUrl(input.imagem_url)].filter(Boolean), botao_texto: String(input.botao_texto || "").trim(), botao_url: safeUrl(input.botao_url),
    ordem_blocos: Array.isArray(input.ordem_blocos) ? input.ordem_blocos.map(String) : ["logo", "titulo", "texto", "botao"], estilos: safeStyles(input.estilos), segmento: safeSegment(input.segmento),
  };
  if (campaign.assunto.length < 3) return json(request, { error: "Preencha o assunto do e-mail." }, 400);
  if (campaign.conteudo.length < 3 && !campaign.imagens_urls.length) return json(request, { error: "Inclua uma mensagem ou uma imagem na campanha." }, 400);
  if ((campaign.botao_texto && !campaign.botao_url) || (!campaign.botao_texto && campaign.botao_url)) return json(request, { error: "Preencha o texto e o link do botão." }, 400);
  const from = Deno.env.get("RESEND_FROM") || "Tio Nan <pedidos@mail.tionan.com.br>";
  if (action === "test") {
    const to = String(input.email_teste || auth.user.email || "").trim();
    if (!validEmail(to)) return json(request, { error: "Informe um e-mail válido para o teste." }, 400);
    try {
      const result = await resend("/emails", { method: "POST", body: JSON.stringify({ from, to: [to], subject: `[TESTE] ${campaign.assunto}`, html: template(campaign, false) }) });
      return json(request, { ok: true, id: result.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(request, { error: `O Resend não aceitou o envio: ${message}` }, 502);
    }
  }
  if (action !== "send") return json(request, { error: "Ação inválida." }, 400);
  let subscribers: MarketingContact[] = [];
  try {
    const audiences = await loadAudiences(db);
    subscribers = audiences[campaign.segmento as keyof typeof audiences];
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
  if (!subscribers.length) return json(request, { error: "Nenhum cliente autorizado pertence a este segmento." }, 409);
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

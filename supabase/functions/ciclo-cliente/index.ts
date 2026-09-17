import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://www.tionan.com.br";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const escapeHtml = (value: unknown) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const validEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const signEmail = async (email: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email))));
};
const firstName = (value: unknown) => escapeHtml(String(value || "Cliente").trim().split(/\s+/)[0] || "Cliente");
const shell = (content: string, unsubscribeUrl = "") => `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:600px){.card{border-radius:14px!important}.pad{padding-left:20px!important;padding-right:20px!important}.title{font-size:27px!important}}</style></head><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#17304f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 10px"><table class="card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border-radius:20px;overflow:hidden"><tr><td style="padding:26px 24px;text-align:center;border-bottom:1px solid #eee7dc"><img src="${SITE}/logo-tio-nan-email.png" width="170" alt="Tio Nan" style="display:inline-block;max-width:70%;height:auto"></td></tr>${content}<tr><td style="padding:22px 28px;background:#0b284b;color:#cbd6e4;text-align:center;font-size:11px;line-height:1.5">Beba com moderação. Venda proibida para menores de 18 anos.${unsubscribeUrl ? `<br><a href="${unsubscribeUrl}" style="display:inline-block;margin-top:10px;color:#efd7a5">Não quero mais receber novidades</a>` : ""}</td></tr></table></td></tr></table></body></html>`;
const reviewHtml = (order: Record<string, unknown>) => shell(`<tr><td class="pad" style="padding:34px 28px 8px"><p style="margin:0 0 9px;color:#b68737;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Conta pra gente</p><h1 class="title" style="margin:0;font-family:Georgia,serif;font-size:31px;line-height:1.12">${firstName(order.cliente_nome)}, o brinde foi bom?</h1><p style="margin:16px 0 0;color:#617086;font-size:16px;line-height:1.6">Esperamos que sua Tio Nan já tenha rendido um encontro daqueles. Sua opinião ajuda outras pessoas a escolherem o próximo brinde — e ajuda a gente a fazer cada experiência ainda melhor.</p></td></tr><tr><td class="pad" style="padding:24px 28px 34px"><a href="${SITE}/avaliar.html?pedido=${encodeURIComponent(String(order.referencia || ""))}" style="display:block;padding:16px 22px;border-radius:12px;background:#c79a49;color:#102d50;text-align:center;text-decoration:none;font-weight:900">AVALIAR MINHA TIO NAN &nbsp;→</a><p style="margin:14px 0 0;text-align:center;color:#8a94a3;font-size:12px">Leva menos de um minuto. Prometemos.</p></td></tr>`);
const reorderHtml = (order: Record<string, unknown>, unsubscribeUrl: string) => {
  const items = (Array.isArray(order.itens_json) ? order.itens_json : []) as Array<Record<string, unknown>>;
  const itemNames = items.slice(0, 3).map((item) => escapeHtml(item.nome)).filter(Boolean).join(", ");
  return shell(`<tr><td class="pad" style="padding:34px 28px 8px"><p style="margin:0 0 9px;color:#b68737;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Hora de renovar o estoque?</p><h1 class="title" style="margin:0;font-family:Georgia,serif;font-size:31px;line-height:1.12">${firstName(order.cliente_nome)}, bateu saudade daquele brinde?</h1><p style="margin:16px 0 0;color:#617086;font-size:16px;line-height:1.6">Já faz um tempinho desde ${itemNames ? `seu pedido de <strong>${itemNames}</strong>` : "seu último pedido"}. Se a garrafa estiver chegando ao fim, deixamos o caminho de volta bem curtinho. 🥃</p></td></tr><tr><td class="pad" style="padding:24px 28px 34px"><a href="${SITE}/todos-produtos.html?utm_source=email&amp;utm_medium=automatico&amp;utm_campaign=recompra" style="display:block;padding:16px 22px;border-radius:12px;background:#c79a49;color:#102d50;text-align:center;text-decoration:none;font-weight:900">ESCOLHER O PRÓXIMO BRINDE &nbsp;→</a></td></tr>`, unsubscribeUrl);
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const input = await request.json().catch(() => ({}));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secret } = await db.from("automacao_segredos").select("valor").eq("nome", "ciclo_cliente_cron").maybeSingle();
  if (!secret?.valor || String(input.cron_token || "") !== String(secret.valor)) return json({ error: "Não autorizado." }, 401);
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) return json({ error: "RESEND_API_KEY não configurada." }, 500);
  const from = Deno.env.get("RESEND_FROM") || "Tio Nan <pedidos@mail.tionan.com.br>";
  const send = async (order: Record<string, unknown>, type: "avaliacao" | "recompra", html: string) => {
    const email = String(order.cliente_email || "").trim().toLowerCase();
    if (!validEmail(email)) throw new Error("E-mail inválido.");
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `${type}-${order.id}` }, body: JSON.stringify({ from, to: [email], subject: type === "avaliacao" ? "O que achou da sua Tio Nan? ⭐" : "Seu próximo brinde está sentindo sua falta 🥃", html }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result?.message || result?.error || `Erro Resend (${response.status})`));
    return result;
  };
  const reviewBefore = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const reorderBefore = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const { data: reviews } = await db.from("pedidos").select("id,referencia,cliente_nome,cliente_email,itens_json").eq("status", "Concluído").not("cliente_email", "is", null).is("email_avaliacao_enviado_em", null).lte("concluido_em", reviewBefore).limit(20);
  const { data: reorders } = await db.from("pedidos").select("id,referencia,cliente_nome,cliente_email,itens_json,concluido_em").eq("status", "Concluído").not("cliente_email", "is", null).is("email_recompra_enviado_em", null).lte("concluido_em", reorderBefore).order("concluido_em", { ascending: false }).limit(20);
  let reviewSent = 0;
  let reorderSent = 0;
  for (const order of reviews || []) {
    try {
      const result = await send(order, "avaliacao", reviewHtml(order));
      await db.from("pedidos").update({ email_avaliacao_enviado_em: new Date().toISOString(), email_avaliacao_resend_id: result.id || null, email_avaliacao_erro: null }).eq("id", order.id).is("email_avaliacao_enviado_em", null);
      reviewSent++;
    } catch (error) {
      await db.from("pedidos").update({ email_avaliacao_erro: String(error instanceof Error ? error.message : error).slice(0, 1000) }).eq("id", order.id);
    }
  }
  const seenEmails = new Set<string>();
  for (const order of reorders || []) {
    const email = String(order.cliente_email || "").trim().toLowerCase();
    if (!validEmail(email) || seenEmails.has(email)) continue;
    seenEmails.add(email);
    const { data: client } = await db.from("clientes").select("marketing_consentimento").ilike("email", email).eq("marketing_consentimento", true).limit(1).maybeSingle();
    if (!client) continue;
    try {
      const signature = await signEmail(email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const unsubscribeUrl = `https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/carrinho-abandonado?action=unsubscribe&email=${encodeURIComponent(email)}&token=${encodeURIComponent(signature)}`;
      const result = await send(order, "recompra", reorderHtml(order, unsubscribeUrl));
      await db.from("pedidos").update({ email_recompra_enviado_em: new Date().toISOString(), email_recompra_resend_id: result.id || null, email_recompra_erro: null }).eq("id", order.id).is("email_recompra_enviado_em", null);
      reorderSent++;
    } catch (error) {
      await db.from("pedidos").update({ email_recompra_erro: String(error instanceof Error ? error.message : error).slice(0, 1000) }).eq("id", order.id);
    }
  }
  return json({ ok: true, avaliacoes_enviadas: reviewSent, recompras_enviadas: reorderSent });
});

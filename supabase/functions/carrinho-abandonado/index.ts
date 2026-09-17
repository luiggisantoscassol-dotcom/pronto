import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://www.tionan.com.br";
const FUNCTION_URL = "https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/carrinho-abandonado";
const allowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "tionan.com.br" || host === "www.tionan.com.br" ? origin : SITE;
  } catch { return SITE; }
};
const cors = (request: Request) => ({
  "access-control-allow-origin": allowedOrigin(request),
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  vary: "Origin",
});
const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(request) });
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]!));
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const signEmail = async (email: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email))));
};
const money = (value: unknown) => Number(Number(value || 0).toFixed(2));
const formatMoney = (value: unknown) => money(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type CartItem = { id: string; nome: string; quantidade: number; preco: number; foto?: string | null; unidades_por_kit?: number };

const emailHtml = (cart: Record<string, unknown>, recoveryUrl: string, unsubscribeUrl: string) => {
  const name = escapeHtml(String(cart.nome || "").trim().split(/\s+/)[0] || "por aí");
  const items = (Array.isArray(cart.itens) ? cart.itens : []) as CartItem[];
  const rows = items.map((item) => `<tr><td style="padding:11px 0;border-bottom:1px solid #ece7de;color:#17304f;font-size:14px"><strong>${escapeHtml(item.nome)}</strong><br><span style="color:#7b8798">Quantidade: ${item.quantidade}</span></td><td style="padding:11px 0;border-bottom:1px solid #ece7de;text-align:right;color:#17304f;font-weight:700;white-space:nowrap">${formatMoney(item.preco * item.quantidade)}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#17304f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border-radius:20px;overflow:hidden"><tr><td style="padding:26px 24px;text-align:center;border-bottom:1px solid #eee7dc"><img src="${SITE}/logo-tio-nan-email.png" width="170" alt="Tio Nan" style="display:inline-block;max-width:70%;height:auto"></td></tr><tr><td style="padding:34px 28px 10px"><p style="margin:0 0 9px;color:#b68737;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Seu brinde ficou esperando</p><h1 style="margin:0;font-family:Georgia,serif;font-size:31px;line-height:1.12;color:#17304f">${name}, sua sacola ainda está por aqui.</h1><p style="margin:16px 0 0;color:#617086;font-size:16px;line-height:1.6">Guardamos sua seleção para você continuar de onde parou — sem pressa, mas antes que alguém brinde primeiro. 🥃</p></td></tr><tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}<tr><td style="padding:16px 0 0;font-weight:800">Total dos produtos</td><td style="padding:16px 0 0;text-align:right;font-size:18px;font-weight:900">${formatMoney(cart.total)}</td></tr></table></td></tr><tr><td style="padding:24px 28px 34px"><a href="${recoveryUrl}" style="display:block;padding:16px 22px;border-radius:12px;background:#c79a49;color:#102d50;text-align:center;text-decoration:none;font-weight:900">RETOMAR MINHA COMPRA &nbsp;→</a><p style="margin:14px 0 0;text-align:center;color:#8a94a3;font-size:12px">Estoque e preços são confirmados ao finalizar o pedido.</p></td></tr><tr><td style="padding:22px 28px;background:#0b284b;color:#cbd6e4;text-align:center;font-size:11px;line-height:1.5">Beba com moderação. Venda proibida para menores de 18 anos.<br><a href="${unsubscribeUrl}" style="display:inline-block;margin-top:10px;color:#efd7a5">Não quero mais receber estes e-mails</a></td></tr></table></td></tr></table></body></html>`;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("action") === "unsubscribe") {
    const email = String(requestUrl.searchParams.get("email") || "").trim().toLowerCase();
    const signature = String(requestUrl.searchParams.get("token") || "");
    const expected = await signEmail(email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!validEmail(email) || signature !== expected) return new Response("Link de descadastro inválido.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    await Promise.all([
      db.from("carrinhos_abandonados").update({ consentimento: false, status: "cancelado", atualizado_em: new Date().toISOString() }).eq("email", email).in("status", ["ativo", "erro", "enviando"]),
      db.from("newsletter_inscritos").update({ consentimento: false, atualizado_em: new Date().toISOString() }).eq("email", email),
      db.from("clientes").update({ marketing_consentimento: false }).ilike("email", email),
    ]);
    return new Response("Tudo certo. Você não receberá mais novidades ou lembretes de compra da Tio Nan.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  const input = await request.json().catch(() => ({}));
  const action = String(input.action || "salvar");

  if (action === "salvar") {
    const token = String(input.token || "");
    const email = String(input.email || "").trim().toLowerCase();
    const nome = String(input.nome || "").trim().slice(0, 120) || null;
    const rawItems = Array.isArray(input.itens) ? input.itens.slice(0, 20) : [];
    if (!validUuid(token) || !validEmail(email) || input.consentimento !== true || !rawItems.length) return json(request, { error: "Dados do carrinho incompletos." }, 400);
    const ids = [...new Set(rawItems.map((item: Record<string, unknown>) => String(item.id || "")).filter(validUuid))];
    if (!ids.length) return json(request, { error: "A sacola não possui produtos válidos." }, 400);
    const { data: existing } = await db.from("carrinhos_abandonados").select("status,enviado_em").eq("token", token).maybeSingle();
    if (existing?.enviado_em || existing?.status === "enviado") return json(request, { ok: true, lembrete: "ja_enviado" });
    const { data: products, error: productsError } = await db.from("produtos").select("id,nome,preco,foto_1,unidades_por_kit,estoque,excluido").in("id", ids).eq("excluido", false);
    if (productsError) return json(request, { error: "Não foi possível validar a sacola." }, 500);
    const items: CartItem[] = [];
    for (const raw of rawItems) {
      const product = (products || []).find((row) => String(row.id) === String(raw.id));
      if (!product) continue;
      const quantidade = Math.max(1, Math.min(12, Math.trunc(Number(raw.quantidade || raw.qtd || 1))));
      if (product.estoque !== null && Number(product.estoque) <= 0) continue;
      items.push({ id: String(product.id), nome: String(product.nome), quantidade, preco: money(product.preco), foto: product.foto_1 || null, unidades_por_kit: Math.max(1, Number(product.unidades_por_kit || 1)) });
    }
    if (!items.length) return json(request, { error: "A sacola não possui produtos disponíveis." }, 409);
    const total = money(items.reduce((sum, item) => sum + item.preco * item.quantidade, 0));
    const now = new Date();
    const { error } = await db.from("carrinhos_abandonados").upsert({
      token, email, nome, itens: items, total, consentimento: true, status: "ativo",
      ultima_atividade_em: now.toISOString(), enviar_apos: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      enviado_em: null, resend_id: null, erro: null, atualizado_em: now.toISOString(),
    }, { onConflict: "token" });
    if (error) return json(request, { error: "Não foi possível guardar a sacola." }, 500);
    return json(request, { ok: true, enviar_apos: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString() });
  }

  if (action === "cancelar") {
    const token = String(input.token || "");
    if (!validUuid(token)) return json(request, { error: "Token inválido." }, 400);
    await db.from("carrinhos_abandonados").update({ status: "convertido", convertido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("token", token).in("status", ["ativo", "erro", "enviando", "enviado"]);
    return json(request, { ok: true });
  }

  if (action === "recuperar") {
    const token = String(input.token || "");
    if (!validUuid(token)) return json(request, { error: "Link inválido." }, 400);
    const { data: cart } = await db.from("carrinhos_abandonados").select("itens,email,nome,status").eq("token", token).maybeSingle();
    if (!cart || ["convertido", "cancelado"].includes(cart.status)) return json(request, { error: "Esta sacola não está mais disponível." }, 404);
    const ids = (Array.isArray(cart.itens) ? cart.itens : []).map((item: CartItem) => item.id);
    const { data: products } = await db.from("produtos").select("id,nome,preco,foto_1,unidades_por_kit,estoque,excluido").in("id", ids).eq("excluido", false);
    const restored = (Array.isArray(cart.itens) ? cart.itens : []).flatMap((saved: CartItem) => {
      const product = (products || []).find((row) => String(row.id) === String(saved.id));
      if (!product || (product.estoque !== null && Number(product.estoque) <= 0)) return [];
      const quantidadeDisponivel = product.estoque === null ? saved.quantidade : Math.max(1, Number(product.estoque));
      return [{ id: String(product.id), name: String(product.nome), price: money(product.preco), cost: 0, qtd: Math.min(saved.quantidade, quantidadeDisponivel), foto: product.foto_1 || saved.foto || "", unidadesPorKit: Math.max(1, Number(product.unidades_por_kit || 1)) }];
    });
    await db.from("carrinhos_abandonados").update({ recuperado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("token", token);
    return json(request, { ok: true, itens: restored, email: cart.email, nome: cart.nome });
  }

  if (action === "unsubscribe") {
    const email = String(input.email || "").trim().toLowerCase();
    const signature = String(input.token || "");
    const expected = await signEmail(email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!validEmail(email) || signature !== expected) return json(request, { error: "Link inválido." }, 400);
    await Promise.all([
      db.from("carrinhos_abandonados").update({ consentimento: false, status: "cancelado", atualizado_em: new Date().toISOString() }).eq("email", email).in("status", ["ativo", "erro", "enviando"]),
      db.from("newsletter_inscritos").update({ consentimento: false, atualizado_em: new Date().toISOString() }).eq("email", email),
      db.from("clientes").update({ marketing_consentimento: false }).ilike("email", email),
    ]);
    return json(request, { ok: true });
  }

  if (action === "processar") {
    const { data: secret } = await db.from("automacao_segredos").select("valor").eq("nome", "carrinho_abandonado_cron").maybeSingle();
    if (!secret?.valor || String(input.cron_token || "") !== String(secret.valor)) return json(request, { error: "Não autorizado." }, 401);
    const { data: due, error } = await db.from("carrinhos_abandonados").select("id,token,email,nome,itens,total,status").in("status", ["ativo", "erro"]).eq("consentimento", true).is("enviado_em", null).lte("enviar_apos", new Date().toISOString()).order("enviar_apos", { ascending: true }).limit(20);
    if (error) return json(request, { error: error.message }, 500);
    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    const from = Deno.env.get("RESEND_FROM") || "Tio Nan <pedidos@mail.tionan.com.br>";
    let sentCount = 0;
    for (const cart of due || []) {
      const { data: claimed } = await db.from("carrinhos_abandonados").update({ status: "enviando", erro: null, atualizado_em: new Date().toISOString() }).eq("id", cart.id).in("status", ["ativo", "erro"]).is("enviado_em", null).select("id").maybeSingle();
      if (!claimed) continue;
      try {
        if (!apiKey) throw new Error("RESEND_API_KEY não configurada.");
        const signature = await signEmail(cart.email, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const recoveryUrl = `${SITE}/?recuperar_carrinho=${encodeURIComponent(cart.token)}`;
        const unsubscribeUrl = `${FUNCTION_URL}?action=unsubscribe&email=${encodeURIComponent(cart.email)}&token=${encodeURIComponent(signature)}`;
        const resendResponse = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `carrinho-${cart.id}` }, body: JSON.stringify({ from, to: [cart.email], subject: "Sua sacola Tio Nan ficou esperando 🥃", html: emailHtml(cart, recoveryUrl, unsubscribeUrl) }) });
        const result = await resendResponse.json().catch(() => ({}));
        if (!resendResponse.ok) throw new Error(String(result?.message || result?.error || `Erro Resend (${resendResponse.status})`));
        await db.from("carrinhos_abandonados").update({ status: "enviado", enviado_em: new Date().toISOString(), resend_id: result.id || null, erro: null, atualizado_em: new Date().toISOString() }).eq("id", cart.id);
        sentCount++;
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        await db.from("carrinhos_abandonados").update({ status: "erro", erro: message.slice(0, 1000), atualizado_em: new Date().toISOString(), enviar_apos: new Date(Date.now() + 60 * 60 * 1000).toISOString() }).eq("id", cart.id);
      }
    }
    return json(request, { ok: true, processados: (due || []).length, enviados: sentCount });
  }

  return json(request, { error: "Ação inválida." }, 400);
});

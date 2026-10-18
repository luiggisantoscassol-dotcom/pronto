import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{ ...cors, "content-type":"application/json" } });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers:cors });
  if (request.method !== "POST") return json({ error:"Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const serviceCall = token === serviceKey;
  if (!serviceCall) {
    const caller = createClient(url, anonKey, { global:{ headers:{ Authorization:authorization } } });
    const { data:isAdmin, error } = await caller.rpc("is_admin");
    if (error || !isAdmin) return json({ error:"Acesso administrativo necessário." }, 403);
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:contato@tionan.com.br";
  if (!publicKey || !privateKey) return json({ error:"Chaves de notificação não configuradas." }, 500);
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = await request.json().catch(() => ({}));
  const test = payload?.teste === true;
  const title = test ? "Alertas ativos no iPhone ✓" : "🥃 Novo pedido Tio Nan";
  const customer = String(payload?.cliente || "Cliente").trim().slice(0, 80);
  const reference = String(payload?.referencia || "").trim().slice(0, 50);
  const body = test ? "Este aparelho receberá avisos de novos pedidos, mesmo com o painel fechado." : `${customer} fez um novo pedido${reference ? ` (${reference})` : ""}.`;
  const notification = JSON.stringify({ title, body, tag:test ? `teste-${Date.now()}` : `pedido-${reference || Date.now()}`, url:"/admin.html#pedidos" });

  const service = createClient(url, serviceKey);
  let query = service.from("admin_push_subscriptions").select("id,endpoint,p256dh,auth_key").eq("ativo", true);
  if (!serviceCall) {
    const { data:{ user } } = await service.auth.getUser(token);
    if (!user) return json({ error:"Sessão inválida." }, 401);
    query = query.eq("user_id", user.id);
  }
  const { data:subscriptions, error:loadError } = await query;
  if (loadError) return json({ error:loadError.message }, 500);
  if (!subscriptions?.length) return json({ error:"Nenhum aparelho possui notificações ativas." }, 409);

  let sent = 0;
  for (const item of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint:item.endpoint, keys:{ p256dh:item.p256dh, auth:item.auth_key } }, notification, { TTL:3600, urgency:"high" });
      sent++;
      const timestamp = new Date().toISOString();
      const update: Record<string, unknown> = { ultimo_envio_em:timestamp, ultimo_erro:null, atualizado_em:timestamp };
      if (test) update.ultimo_teste_em = timestamp;
      await service.from("admin_push_subscriptions").update(update).eq("id", item.id);
    } catch (error) {
      const status = Number((error as { statusCode?:number })?.statusCode || 0);
      await service.from("admin_push_subscriptions").update({ ativo:![404,410].includes(status), ultimo_erro:String((error as Error)?.message || error).slice(0,500), atualizado_em:new Date().toISOString() }).eq("id", item.id);
    }
  }
  return json({ ok:true, enviados:sent, cadastrados:subscriptions.length });
});

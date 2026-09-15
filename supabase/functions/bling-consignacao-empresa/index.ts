import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE = "https://api.bling.com.br/Api/v3";
const allowed = (origin: string | null) => {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === "https:" && (u.hostname === "tionan.com.br" || u.hostname === "www.tionan.com.br" || u.hostname.endsWith(".vercel.app"))) ||
      (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch { return false; }
};
const cors = (o: string | null) => ({
  "access-control-allow-origin": o && allowed(o) ? o : "https://www.tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const json = (o: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(o), "content-type": "application/json; charset=utf-8" } });
const detail = (d: any, status: number) => d?.error?.fields?.map?.((f: any) => `${f.element || "campo"}: ${f.msg || f.message || "inválido"}`).join("; ") || d?.error?.description || d?.error?.message || d?.message || `Erro Bling (${status})`;
const digits = (v: unknown) => String(v || "").replace(/\D/g, "");

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json(origin, { error: "Use POST." }, 405);
  if (!allowed(origin)) return json(origin, { error: "Origem não autorizada." }, 403);

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return json(origin, { error: "Sessão administrativa inválida." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (!admin) return json(origin, { error: "Acesso administrativo necessário." }, 403);

  const input = await req.json().catch(() => ({}));
  const action = String(input.action || "sincronizar");
  const empresaId = String(input.empresa_id || "");
  if (!empresaId) return json(origin, { error: "Empresa inválida." }, 400);
  const { data: empresa, error } = await db.from("consignacao_empresas").select("*").eq("id", empresaId).single();
  if (error || !empresa) return json(origin, { error: "Empresa não encontrada." }, 404);
  const documento = digits(empresa.documento);
  if (![11, 14].includes(documento.length)) return json(origin, { error: "Informe CPF ou CNPJ válido." }, 400);

  const { data: conn } = await db.from("bling_integracao").select("access_token,refresh_token,expires_at").eq("id", "principal").single();
  if (!conn?.access_token) return json(origin, { error: "Bling ainda não está conectado." }, 409);
  let access = conn.access_token;
  if (conn.expires_at && new Date(conn.expires_at) <= new Date(Date.now() + 60000)) {
    const credentials = btoa(`${Deno.env.get("BLING_CLIENT_ID")}:${Deno.env.get("BLING_CLIENT_SECRET")}`);
    const response = await fetch(`${API_BASE}/oauth/token`, { method: "POST", headers: { authorization: `Basic ${credentials}`, "content-type": "application/x-www-form-urlencoded", "enable-jwt": "1" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
    const refreshed = await response.json().catch(() => ({}));
    if (!response.ok) return json(origin, { error: "A conexão com o Bling expirou. Reconecte o aplicativo." }, 401);
    access = refreshed.access_token;
    await db.from("bling_integracao").update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || conn.refresh_token, expires_at: new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString(), atualizado_em: new Date().toISOString() }).eq("id", "principal");
  }
  const bling = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { authorization: `Bearer ${access}`, accept: "application/json", "enable-jwt": "1", ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(detail(data, response.status));
    return data;
  };

  try {
    if (action === "excluir") {
      const { data: saldos, error: saldoError } = await db.from("consignacao_saldos").select("quantidade").eq("empresa_id", empresaId);
      if (saldoError) throw saldoError;
      const saldo = (saldos || []).reduce((total: number, item: any) => total + Number(item.quantidade || 0), 0);
      if (saldo > 0) return json(origin, { error: `Ainda existem ${saldo} garrafa(s) em consignação. Registre a venda ou devolução antes de excluir.` }, 409);
      const contatoId = String(empresa.bling_contato_id || "");
      if (contatoId) {
        const response = await fetch(`${API_BASE}/contatos/${encodeURIComponent(contatoId)}`, { method: "DELETE", headers: { authorization: `Bearer ${access}`, accept: "application/json", "enable-jwt": "1" } });
        if (!response.ok && response.status !== 404) {
          const data = await response.json().catch(() => ({}));
          throw new Error(detail(data, response.status));
        }
      }
      const archived = await db.from("consignacao_empresas").update({ ativa: false, bling_contato_id: null, atualizado_em: new Date().toISOString() }).eq("id", empresaId);
      if (archived.error) throw archived.error;
      return json(origin, { ok: true, bling_excluido: Boolean(contatoId) });
    }
    if (action !== "sincronizar") return json(origin, { error: "Ação inválida." }, 400);
    const endereco = { geral: { endereco: empresa.endereco, numero: empresa.numero, complemento: empresa.complemento || "", bairro: empresa.bairro, cep: digits(empresa.cep).slice(0, 8), municipio: empresa.cidade, uf: String(empresa.uf || "").toUpperCase() } };
    const indicadorIe = Number(empresa.indicador_ie);
    if (![1, 2, 9].includes(indicadorIe)) return json(origin, { error: "Informe no painel se a empresa é contribuinte, isenta ou não contribuinte de ICMS." }, 409);
    if (indicadorIe === 1 && !String(empresa.inscricao_estadual || "").trim()) return json(origin, { error: "A inscrição estadual é obrigatória para empresa contribuinte de ICMS." }, 409);
    const payload: Record<string, unknown> = { nome: String(empresa.nome).trim(), fantasia: empresa.nome_fantasia || undefined, tipo: documento.length === 14 ? "J" : "F", situacao: "A", numeroDocumento: documento, indicadorIe, endereco };
    if (empresa.inscricao_estadual) payload.ie = String(empresa.inscricao_estadual).trim();
    if (empresa.email) { payload.email = String(empresa.email).trim(); payload.emailNotaFiscal = String(empresa.email).trim(); }
    const telefone = digits(empresa.telefone);
    if (telefone.length >= 10) payload.celular = telefone;

    let contatoId = String(empresa.bling_contato_id || ""), criado = false;
    if (!contatoId) {
      const found = await bling(`/contatos?pagina=1&limite=100&pesquisa=${encodeURIComponent(documento)}`);
      for (const candidate of (found?.data || []).slice(0, 10)) {
        if (!candidate?.id) continue;
        const current = await bling(`/contatos/${candidate.id}`);
        if (digits(current?.data?.numeroDocumento) === documento) { contatoId = String(candidate.id); break; }
      }
    }
    if (contatoId) {
      await bling(`/contatos/${encodeURIComponent(contatoId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      const created = await bling("/contatos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      contatoId = String(created?.data?.id || created?.id || ""); criado = true;
    }
    if (!contatoId) throw new Error("O Bling não retornou o código do contato.");
    const updated = await db.from("consignacao_empresas").update({ bling_contato_id: contatoId, atualizado_em: new Date().toISOString() }).eq("id", empresaId);
    if (updated.error) throw updated.error;
    return json(origin, { ok: true, criado, contato_id: contatoId });
  } catch (e) {
    return json(origin, { error: e instanceof Error ? e.message : "Falha ao cadastrar empresa no Bling." }, 422);
  }
});

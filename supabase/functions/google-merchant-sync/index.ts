import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://www.tionan.com.br";
const ACCOUNT_ID = Deno.env.get("GOOGLE_MERCHANT_ACCOUNT_ID") || "5873995150";
const CONTENT_LANGUAGE = "pt";
const FEED_LABEL = "BR";
const ACTIVE_LEGACY_BLING_IDS = new Set([
  "16699719562",
  "16699660347",
  "16712113631",
  "16687078597",
  "16712114193",
]);

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-sync-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

type Product = {
  id: string;
  nome: string | null;
  descricao: string | null;
  preco: number | string | null;
  estoque: number | string | null;
  bling_id: string | number | null;
  foto_1: string | null;
  tipo_produto: string | null;
  visivel: boolean | null;
  excluido: boolean | null;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type OAuthCredentials = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string) {
  const binary = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function serviceAccountAccessToken(credentials: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/content",
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Falha ao autorizar a conta de serviço no Google: ${data.error_description || data.error || response.status}`);
  }
  return String(data.access_token);
}

async function oauthAccessToken(credentials: OAuthCredentials) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Falha ao renovar a autorização do Google: ${data.error_description || data.error || response.status}`);
  }
  return String(data.access_token);
}

async function accessToken() {
  const oauthJson = Deno.env.get("GOOGLE_MERCHANT_OAUTH_JSON")?.trim();
  if (oauthJson) {
    const credentials = JSON.parse(oauthJson) as OAuthCredentials;
    if (!credentials.client_id || !credentials.client_secret || !credentials.refresh_token) {
      throw new Error("JSON OAuth do Google inválido.");
    }
    return await oauthAccessToken(credentials);
  }

  const serviceAccountJson = Deno.env.get("GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON")?.trim();
  if (!serviceAccountJson) {
    throw new Error("A autorização OAuth do Google ainda não foi configurada.");
  }
  const credentials = JSON.parse(serviceAccountJson) as ServiceAccount;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("JSON da conta de serviço inválido.");
  }
  return await serviceAccountAccessToken(credentials);
}

async function merchantRequest(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (response.ok) return response.status === 204 ? null : await response.json();
  const text = await response.text();
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    detail = parsed?.error?.message || parsed?.message || text;
  } catch { /* resposta não JSON */ }
  throw new Error(`Merchant API (${response.status}): ${detail}`);
}

async function resolveDataSource(token: string) {
  const configured = Deno.env.get("GOOGLE_MERCHANT_DATASOURCE_ID")?.trim();
  if (configured) {
    return configured.startsWith("accounts/")
      ? configured
      : `accounts/${ACCOUNT_ID}/dataSources/${configured}`;
  }
  const result = await merchantRequest(
    token,
    `https://merchantapi.googleapis.com/datasources/v1/accounts/${ACCOUNT_ID}/dataSources?pageSize=100`,
  );
  const sources = Array.isArray(result?.dataSources) ? result.dataSources : [];
  const source = sources.find((item: Record<string, unknown>) => {
    const primary = item.primaryProductDataSource as Record<string, unknown> | undefined;
    return primary && String(primary.contentLanguage || "").toLowerCase() === CONTENT_LANGUAGE &&
      String(primary.feedLabel || "").toUpperCase() === FEED_LABEL;
  }) || sources.find((item: Record<string, unknown>) => Boolean(item.primaryProductDataSource));
  if (!source?.name) {
    throw new Error("Nenhuma fonte primária de produtos por API foi encontrada no Merchant Center.");
  }
  return String(source.name);
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function offerId(product: Product) {
  return String(product.bling_id || product.id).trim();
}

function publicProduct(product: Product) {
  if (product.excluido) return false;
  if (product.visivel === true) return true;
  return product.visivel === null && ACTIVE_LEGACY_BLING_IDS.has(String(product.bling_id || ""));
}

function imageUrl(product: Product) {
  const custom = String(product.foto_1 || "").trim();
  if (/^https:\/\//i.test(custom)) return custom;
  const blingId = String(product.bling_id || "");
  if (blingId === "16699719562") return `${SITE_URL}/fotos/gengibre-guaco-mel.webp?v=5`;
  if (blingId === "16699660347") return `${SITE_URL}/fotos/cachaca-ouro.webp?v=2`;
  if (custom && !custom.includes("produto-em-breve")) return new URL(custom, `${SITE_URL}/`).href;
  return "";
}

function cleanDescription(product: Product) {
  const value = String(product.descricao || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return value || `${product.nome} Tio Nan. Produzida no Brasil para celebrar bons encontros com qualidade e autenticidade.`;
}

function productInput(product: Product) {
  const id = offerId(product);
  const image = imageUrl(product);
  if (!image) throw new Error("Produto sem imagem pública válida.");
  const price = Number(product.preco || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Produto sem preço válido.");
  return {
    offerId: id,
    contentLanguage: CONTENT_LANGUAGE,
    feedLabel: FEED_LABEL,
    productAttributes: {
      title: String(product.nome || "Produto Tio Nan").trim().slice(0, 150),
      description: cleanDescription(product).slice(0, 5000),
      link: `${SITE_URL}/produtos/${slug(String(product.nome || id))}`,
      imageLink: image,
      availability: Number(product.estoque || 0) > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
      price: {
        amountMicros: String(Math.round(price * 1_000_000)),
        currencyCode: "BRL",
      },
      condition: "NEW",
      brand: "Tio Nan",
      mpn: id,
      adult: true,
      googleProductCategory: "499676",
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);

  const syncSecret = Deno.env.get("MERCHANT_SYNC_SECRET") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const validSyncSecret = Boolean(syncSecret) && request.headers.get("x-sync-secret") === syncSecret;
  const validServiceRole = Boolean(serviceRole) && bearer === serviceRole;
  if (!validSyncSecret && !validServiceRole) {
    return json({ error: "Não autorizado." }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl || !serviceRole) throw new Error("Credenciais do Supabase ausentes.");
    const token = await accessToken();
    const dataSource = await resolveDataSource(token);
    const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const { data, error } = await db.from("produtos").select(
      "id,nome,descricao,preco,estoque,bling_id,foto_1,tipo_produto,visivel,excluido",
    );
    if (error) throw error;
    const products = (data || []) as Product[];
    const visible = products.filter(publicProduct);
    const visibleIds = new Set(visible.map(offerId));
    const results: Array<Record<string, unknown>> = [];

    for (const product of visible) {
      const id = offerId(product);
      try {
        const payload = productInput(product);
        await merchantRequest(
          token,
          `https://merchantapi.googleapis.com/products/v1/accounts/${ACCOUNT_ID}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        await db.from("google_merchant_sync").upsert({
          product_id: product.id,
          offer_id: id,
          active: true,
          last_synced_at: new Date().toISOString(),
          last_error: null,
        }, { onConflict: "offer_id" });
        results.push({ offer_id: id, status: "sincronizado" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.from("google_merchant_sync").upsert({
          product_id: product.id,
          offer_id: id,
          active: false,
          last_error: message,
        }, { onConflict: "offer_id" });
        results.push({ offer_id: id, status: "erro", error: message });
      }
    }

    const { data: tracked } = await db.from("google_merchant_sync").select("offer_id,active").eq("active", true);
    for (const entry of tracked || []) {
      const id = String(entry.offer_id);
      if (visibleIds.has(id)) continue;
      try {
        const productId = encodeURIComponent(`${CONTENT_LANGUAGE}~${FEED_LABEL}~${id}`);
        await merchantRequest(
          token,
          `https://merchantapi.googleapis.com/products/v1/accounts/${ACCOUNT_ID}/productInputs/${productId}?dataSource=${encodeURIComponent(dataSource)}`,
          { method: "DELETE" },
        );
        await db.from("google_merchant_sync").update({
          active: false,
          removed_at: new Date().toISOString(),
          last_error: null,
        }).eq("offer_id", id);
        results.push({ offer_id: id, status: "removido" });
      } catch (error) {
        results.push({ offer_id: id, status: "erro_ao_remover", error: error instanceof Error ? error.message : String(error) });
      }
    }

    const failures = results.filter((item) => String(item.status).startsWith("erro"));
    return json({
      ok: failures.length === 0,
      account_id: ACCOUNT_ID,
      data_source: dataSource,
      products: results,
      synchronized: results.length - failures.length,
      failures: failures.length,
    }, failures.length ? 207 : 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

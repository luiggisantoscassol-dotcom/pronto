import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://www.tionan.com.br";
const ACTIVE_BLING_IDS = new Set(["16699719562", "16699660347", "16687078597"]);

function slugify(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(location: string, lastModified: string, changeFrequency: string, priority: string) {
  return `  <url>\n    <loc>${xml(location)}</loc>\n    <lastmod>${xml(lastModified)}</lastmod>\n    <changefreq>${changeFrequency}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return new Response("Sitemap unavailable", { status: 503 });

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("produtos")
    .select("nome,bling_id,tipo_produto,visivel,excluido")
    .eq("excluido", false)
    .or("visivel.eq.true,visivel.is.null");

  if (error) return new Response("Sitemap unavailable", { status: 503 });

  const today = new Date().toISOString().slice(0, 10);
  const staticEntries = [
    urlEntry(`${SITE_URL}/`, today, "weekly", "1.0"),
    urlEntry(`${SITE_URL}/todos-produtos.html`, today, "daily", "0.9"),
    urlEntry(`${SITE_URL}/links.html`, today, "monthly", "0.6")
  ];
  const seen = new Set<string>();
  const publicProducts = (data || []).filter((product) =>
    ACTIVE_BLING_IDS.has(String(product.bling_id || "")) ||
    (product.tipo_produto === "kit" && product.visivel === true)
  );
  const productEntries = publicProducts.flatMap((product) => {
    const slug = slugify(product.nome);
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [urlEntry(`${SITE_URL}/produtos/${slug}`, today, "weekly", "0.8")];
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticEntries, ...productEntries].join("\n")}\n</urlset>\n`;

  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff"
    }
  });
});

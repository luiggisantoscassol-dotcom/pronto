import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://www.tionan.com.br";
const PRODUCT_TEMPLATE_URL = `${SITE_URL}/produto.html`;

function slugify(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeAttribute(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function absoluteUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return `${SITE_URL}/fotos/cachaca-ouro.webp`;
  const drive = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (raw.includes("drive.google") && drive?.[1]) {
    return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1200`;
  }
  try { return new URL(raw, `${SITE_URL}/`).href; }
  catch { return `${SITE_URL}/fotos/cachaca-ouro.webp`; }
}

function replaceMeta(html: string, selector: string, value: string) {
  const escaped = escapeAttribute(value);
  const property = selector.startsWith("og:") ? "property" : "name";
  const pattern = new RegExp(`<meta\\s+${property}=["']${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i");
  return html.replace(pattern, `<meta ${property}="${selector}" content="${escaped}" />`);
}

function replaceLink(html: string, id: string, href: string) {
  const pattern = new RegExp(`<link\\s+([^>]*\\s)?id=["']${id}["'][^>]*>`, "i");
  return html.replace(pattern, `<link rel="canonical" id="${id}" href="${escapeAttribute(href)}" />`);
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const slug = slugify(new URL(request.url).searchParams.get("slug"));
  const templateResponse = await fetch(PRODUCT_TEMPLATE_URL, {
    headers: { "user-agent": "TioNan-Product-Renderer/1.0" },
  });
  if (!templateResponse.ok) return new Response("Produto indisponível", { status: 502 });
  let html = await templateResponse.text();

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await db
    .from("produtos")
    .select("id,nome,descricao,preco,foto_1,foto_2,estoque,lancado,bling_id")
    .eq("excluido", false);

  if (error) return new Response("Falha ao carregar produto", { status: 500 });
  const product = (data || []).find((item) => {
    const itemSlug = slugify(item.nome);
    return itemSlug === slug || itemSlug.replace(/^cachaca-/, "") === slug;
  });
  if (!product) return new Response("Produto não encontrado", { status: 404 });

  const name = String(product.nome || "Produto Tio Nan").trim();
  const title = `${name} | Tio Nan`;
  const description = String(product.descricao || `${name} Tio Nan. Compre online com entrega para todo o Brasil.`)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const image = absoluteUrl(product.foto_1 || product.foto_2);
  const canonical = `${SITE_URL}/produtos/${slugify(name)}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    image: [image],
    sku: String(product.bling_id || product.id || ""),
    brand: { "@type": "Brand", name: "Tio Nan" },
    offers: {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "BRL",
      price: Number(product.preco || 0).toFixed(2),
      availability: product.lancado === false
        ? "https://schema.org/PreOrder"
        : Number(product.estoque || 0) > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    },
  };

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttribute(title)}</title>`);
  html = replaceLink(html, "seo-canonical", canonical);
  html = replaceMeta(html, "description", description);
  html = replaceMeta(html, "og:title", title);
  html = replaceMeta(html, "og:description", description);
  html = replaceMeta(html, "og:url", canonical);
  html = replaceMeta(html, "og:image", image);
  html = replaceMeta(html, "twitter:title", title);
  html = replaceMeta(html, "twitter:description", description);
  html = replaceMeta(html, "twitter:image", image);
  html = html.replace(
    /<script type="application\/ld\+json" id="product-structured-data">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json" id="product-structured-data">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`,
  );

  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      "x-robots-tag": "index, follow",
    },
  });
});

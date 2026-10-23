const PRODUTO_SEO_URL =
  "https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/produto-seo";

module.exports = async function produtoSeo(req, res) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    res.status(400).send("Produto inválido.");
    return;
  }

  try {
    const upstream = await fetch(
      `${PRODUTO_SEO_URL}?slug=${encodeURIComponent(slug)}`,
      { headers: { accept: "text/html" } },
    );
    const html = await upstream.text();

    res.status(upstream.status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(html);
  } catch (error) {
    console.error("Falha ao carregar página de produto", error);
    res.status(502).send("Não foi possível carregar este produto agora.");
  }
};

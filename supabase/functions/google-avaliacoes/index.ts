import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://www.tionan.com.br";
const CACHE_MS = 24 * 60 * 60 * 1000;
const allowed = (origin: string | null) => !origin
  || [SITE, "https://tionan.com.br"].includes(origin)
  || /^https:\/\/[^/]+\.vercel\.app$/.test(origin)
  || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const headers = (origin: string | null) => ({
  "access-control-allow-origin": origin && allowed(origin) ? origin : SITE,
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400",
  vary: "Origin",
});
const reply = (origin: string | null, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "GET") return reply(origin, { error: "Use GET." }, 405);
  if (!allowed(origin)) return reply(origin, { error: "Origem não autorizada." }, 403);

  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  let placeId = Deno.env.get("GOOGLE_PLACE_ID") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceKey) {
    return reply(origin, { configured: false }, 503);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: cached } = await db.from("google_reviews_cache")
    .select("payload,updated_at")
    .eq("id", 1)
    .maybeSingle();
  const age = cached?.updated_at ? Date.now() - new Date(cached.updated_at).getTime() : Infinity;
  if (cached?.payload && age < CACHE_MS) return reply(origin, cached.payload);

  placeId = placeId || String(cached?.payload?.placeId || "");
  if (!placeId) {
    const textQuery = Deno.env.get("GOOGLE_PLACE_QUERY")
      || "Tio Nan, Avenida Bento Gonçalves 4321, Porto Alegre, RS, Brasil";
    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery, languageCode: "pt-BR", regionCode: "BR", pageSize: 1 }),
    });
    if (!searchResponse.ok) {
      const detail = (await searchResponse.text()).slice(0, 800);
      console.error("Google Places search error", searchResponse.status, detail);
      return reply(origin, { error: "Não foi possível localizar o perfil da empresa." }, 502);
    }
    const search = await searchResponse.json();
    placeId = String(search?.places?.[0]?.id || "");
    if (!placeId) return reply(origin, { error: "Perfil da empresa não localizado." }, 404);
  }

  const fields = ["displayName", "rating", "userRatingCount", "reviews", "googleMapsUri"].join(",");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=pt-BR`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fields },
  });
  if (!response.ok) {
    console.error("Google Places error", response.status, await response.text());
    if (cached?.payload) return reply(origin, cached.payload);
    return reply(origin, { error: "Avaliações temporariamente indisponíveis." }, 502);
  }

  const place = await response.json();
  const reviews = Array.isArray(place.reviews) ? place.reviews.slice(0, 5).map((review: any) => ({
    author: String(review?.authorAttribution?.displayName || "Cliente Google"),
    authorUrl: String(review?.authorAttribution?.uri || ""),
    photoUrl: String(review?.authorAttribution?.photoUri || ""),
    rating: Number(review?.rating || 0),
    text: String(review?.text?.text || review?.originalText?.text || ""),
    published: String(review?.relativePublishTimeDescription || ""),
    reviewUrl: String(review?.googleMapsUri || ""),
  })) : [];
  const payload = {
    configured: true,
    placeId,
    name: String(place?.displayName?.text || "Tio Nan"),
    rating: Number(place?.rating || 0),
    total: Number(place?.userRatingCount || 0),
    googleMapsUrl: String(place?.googleMapsUri || ""),
    writeReviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    reviews,
    updatedAt: new Date().toISOString(),
  };
  const { error: cacheError } = await db.from("google_reviews_cache")
    .upsert({ id: 1, payload, updated_at: new Date().toISOString() });
  if (cacheError) console.error("Google reviews cache error", cacheError.message);
  return reply(origin, payload);
});

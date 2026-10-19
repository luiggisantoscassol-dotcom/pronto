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
  const placeId = Deno.env.get("GOOGLE_PLACE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !placeId || !supabaseUrl || !serviceKey) {
    return reply(origin, { configured: false }, 503);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: cached } = await db.from("google_reviews_cache")
    .select("payload,updated_at")
    .eq("id", 1)
    .maybeSingle();
  const age = cached?.updated_at ? Date.now() - new Date(cached.updated_at).getTime() : Infinity;
  if (cached?.payload && age < CACHE_MS) return reply(origin, cached.payload);

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

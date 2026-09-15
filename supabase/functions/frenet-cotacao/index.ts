const isAllowedOrigin = (origin: string) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && (url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br" || url.hostname.endsWith(".vercel.app"))) return true;
    if (url.protocol !== "http:") return false;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    const parts = url.hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  } catch { return false; }
};

const cors = (origin: string) => ({
  "access-control-allow-origin": isAllowedOrigin(origin) ? (origin || "https://tionan.com.br") : "https://tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const json = (origin: string, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" },
});

const quoteFrenet = async (token: string, destination: string, quantity: number, invoiceValue: number) => {
  const sellerCep = String(Deno.env.get("FRENET_FROM_POSTAL_CODE") || "90650003").replace(/\D/g, "");
  const response = await fetch("https://api.frenet.com.br/shipping/quote", {
    method: "POST",
    headers: { token, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      SellerCEP: sellerCep,
      RecipientCEP: destination,
      RecipientCountry: "BR",
      ShipmentInvoiceValue: Math.max(1, invoiceValue),
      ShippingItemArray: [{
        Weight: 1.5,
        Length: 12,
        Height: 36,
        Width: 12,
        Quantity: quantity,
        SKU: "garrafa-700ml",
        Category: "Bebidas",
        isFragile: true,
      }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, sellerCep };
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Método inválido." }, 405);
  if (!isAllowedOrigin(origin)) return json(origin, { error: "Origem não autorizada." }, 403);

  const token = Deno.env.get("FRENET_TOKEN") || "";
  if (!token) return json(origin, { error: "Token da Frenet não configurado." }, 503);
  const body = await request.json().catch(() => ({}));
  const destination = String(body?.cep || "").replace(/\D/g, "");
  const quantity = Math.max(1, Math.min(30, Math.trunc(Number(body?.quantidade || 1))));
  const invoiceValue = Math.max(1, Number(body?.valor_pedido || quantity * 55));
  if (destination.length !== 8) return json(origin, { error: "CEP de destino inválido." }, 400);

  const { response, data } = await quoteFrenet(token, destination, quantity, invoiceValue);
  if (!response.ok) return json(origin, { error: data?.Message || data?.message || "Não foi possível calcular o frete na Frenet.", detail: data }, response.status);
  const services = Array.isArray(data?.ShippingSevicesArray) ? data.ShippingSevicesArray : [];
  const quotes = services
    .filter((item: Record<string, unknown>) => item?.Error !== true)
    .map((item: Record<string, unknown>) => ({
      id: String(item.ServiceCode || ""),
      nome: String(item.ServiceDescription || "Entrega"),
      transportadora: String(item.Carrier || "Transportadora"),
      transportadora_codigo: String(item.CarrierCode || ""),
      preco: Number(item.ShippingPrice || 0),
      preco_original: Number(item.OriginalShippingPrice || item.ShippingPrice || 0),
      prazo: Number(item.DeliveryTime || 0),
      prazo_original: Number(item.OriginalDeliveryTime || item.DeliveryTime || 0),
    }))
    .filter((item: Record<string, unknown>) => item.id && Number(item.preco) > 0)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.preco) - Number(b.preco));
  return json(origin, { cotacoes: quotes, origem: "frenet" });
});

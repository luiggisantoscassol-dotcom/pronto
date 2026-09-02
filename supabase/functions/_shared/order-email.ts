const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]!));

export async function sendOrderConfirmation(input: { email: string; name: string; reference: string; trackingToken: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY ausente" };
  const trackingUrl = `https://www.tionan.com.br/pedido.html?token=${encodeURIComponent(input.trackingToken)}`;
  const shortReference = input.reference.slice(0, 8).toUpperCase();
  const name = escapeHtml(input.name);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `pedido-confirmado-${input.reference}`,
    },
    body: JSON.stringify({
      from: "Tio Nan <pedidos@mail.tionan.com.br>",
      to: [input.email],
      subject: `Recebemos seu pedido ${shortReference} | Tio Nan`,
      html: `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#1b365d"><div style="max-width:580px;margin:0 auto;padding:36px 18px"><div style="background:#fff;border-radius:18px;padding:34px;border:1px solid #e5e0d7"><div style="text-align:center;margin-bottom:26px"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="190" alt="Tio Nan" style="display:block;width:190px;max-width:70%;height:auto;margin:0 auto"></div><h1 style="font-size:25px;text-align:center;margin:0 0 14px">Pedido recebido!</h1><p style="line-height:1.6;color:#667085">Olá, ${name}. Recebemos o pedido <strong>${shortReference}</strong>. Você pode acompanhar todas as etapas pelo botão abaixo.</p><a href="${trackingUrl}" style="display:block;margin:28px 0;padding:17px;text-align:center;background:#1b365d;color:#fff;text-decoration:none;border:1px solid #c5a059;border-radius:12px;font-weight:800">ACOMPANHAR MEU PEDIDO</a><p style="font-size:12px;line-height:1.5;color:#8a8f98">Guarde este e-mail. O botão contém o acesso seguro ao acompanhamento do seu pedido.</p></div></div></body></html>`,
      text: `Olá, ${input.name}. Recebemos seu pedido ${shortReference}. Acompanhe em: ${trackingUrl}`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, error: data?.message || "Falha no envio" };
}

const STATUS_CONTENT: Record<string, { subject: string; title: string; message: string }> = {
  "Confirmado": { subject: "Pedido confirmado", title: "Pedido confirmado!", message: "Seu pedido foi confirmado e já está sendo processado." },
  "Em Preparo": { subject: "Pedido em preparo", title: "Estamos preparando seu pedido", message: "Sua Tio Nan já está em fase de preparo." },
  "Saiu para Entrega": { subject: "Pedido saiu para entrega", title: "Seu pedido está a caminho!", message: "Seu pedido saiu para entrega e logo chegará até você." },
  "Concluído": { subject: "Pedido concluído", title: "Pedido concluído!", message: "Seu pedido foi entregue ou retirado. Saúde!" },
  "Cancelado": { subject: "Pedido cancelado", title: "Pedido cancelado", message: "Seu pedido foi cancelado. Fale conosco caso precise de ajuda." },
};

export async function sendOrderStatusUpdate(input: { email: string; name: string; reference: string; trackingToken: string; status: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const content = STATUS_CONTENT[input.status];
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY ausente" };
  if (!content) return { ok: false, skipped: true, error: "Status sem notificação" };
  const trackingUrl = `https://www.tionan.com.br/pedido.html?token=${encodeURIComponent(input.trackingToken)}`;
  const shortReference = input.reference.slice(0, 8).toUpperCase();
  const name = escapeHtml(input.name);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `pedido-status-${input.reference}-${input.status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` },
    body: JSON.stringify({
      from: "Tio Nan <pedidos@mail.tionan.com.br>",
      to: [input.email],
      subject: `${content.subject} — ${shortReference} | Tio Nan`,
      html: `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#1b365d"><div style="max-width:580px;margin:0 auto;padding:36px 18px"><div style="background:#fff;border-radius:18px;padding:34px;border:1px solid #e5e0d7"><div style="text-align:center;margin-bottom:26px"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="190" alt="Tio Nan" style="display:block;width:190px;max-width:70%;height:auto;margin:0 auto"></div><h1 style="font-size:25px;text-align:center;margin:0 0 14px">${content.title}</h1><p style="line-height:1.6;color:#667085">Olá, ${name}. ${content.message}</p><p style="line-height:1.6;color:#667085">Pedido <strong>${shortReference}</strong>.</p><a href="${trackingUrl}" style="display:block;margin:28px 0;padding:17px;text-align:center;background:#1b365d;color:#fff;text-decoration:none;border:1px solid #c5a059;border-radius:12px;font-weight:800">ACOMPANHAR MEU PEDIDO</a></div></div></body></html>`,
      text: `Olá, ${input.name}. ${content.message} Pedido ${shortReference}. Acompanhe em: ${trackingUrl}`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, error: data?.message || "Falha no envio" };
}

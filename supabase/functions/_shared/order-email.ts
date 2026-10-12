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
      subject: `Seu pedido ${shortReference} chegou por aqui 🥃 | Tio Nan`,
      html: `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#1b365d"><div style="max-width:580px;margin:0 auto;padding:36px 18px"><div style="background:#fff;border-radius:18px;padding:34px;border:1px solid #e5e0d7"><div style="text-align:center;margin-bottom:26px"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="190" alt="Tio Nan" style="display:block;width:190px;max-width:70%;height:auto;margin:0 auto"></div><h1 style="font-size:25px;text-align:center;margin:0 0 14px">Boa escolha, ${name}! 🥃</h1><p style="line-height:1.6;color:#667085">Seu pedido <strong>${shortReference}</strong> chegou direitinho por aqui. Agora deixa com a gente: vamos cuidar de cada detalhe e avisar você pelo caminho.</p><a href="${trackingUrl}" style="display:block;margin:28px 0;padding:17px;text-align:center;background:#1b365d;color:#fff;text-decoration:none;border:1px solid #c5a059;border-radius:12px;font-weight:800">ACOMPANHAR MEU PEDIDO</a><p style="font-size:13px;line-height:1.6;color:#8a8f98">Guarde este e-mail — esse botão é seu atalho seguro para acompanhar tudo. Saúde!<br><strong>Equipe Tio Nan</strong></p></div></div></body></html>`,
      text: `Boa escolha, ${input.name}! Seu pedido ${shortReference} chegou direitinho por aqui. Acompanhe em: ${trackingUrl} — Equipe Tio Nan`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, error: data?.message || "Falha no envio" };
}

const STATUS_CONTENT: Record<string, { subject: string; title: string; message: string }> = {
  "Confirmado": { subject: "Tudo certo com seu pedido 🥃", title: "Pedido confirmado!", message: "Está tudo certo: confirmamos seu pedido e ele já entrou na nossa fila de cuidados." },
  "Em Preparo": { subject: "Sua Tio Nan está sendo preparada", title: "Mãos à obra por aqui!", message: "Sua Tio Nan já está sendo preparada com todo o cuidado para seguir viagem." },
  "Saiu para Entrega": { subject: "Tem Tio Nan a caminho 🚚", title: "Seu pedido pegou a estrada!", message: "Seu pedido saiu para entrega. Agora é só preparar o copo — ele logo chega até você." },
  "Concluído": { subject: "Pedido entregue. Agora é brindar! 🥃", title: "Chegou a boa!", message: "Seu pedido foi entregue ou retirado. Esperamos que cada gole renda uma boa história. Saúde!" },
  "Cancelado": { subject: "Seu pedido foi cancelado", title: "Pedido cancelado", message: "Poxa, desta vez não deu para seguir com o pedido. O cancelamento foi concluído e estamos por aqui caso você precise de ajuda." },
};

export async function sendOrderStatusUpdate(input: { email: string; name: string; reference: string; trackingToken: string; status: string; reason?: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const content = STATUS_CONTENT[input.status];
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY ausente" };
  if (!content) return { ok: false, skipped: true, error: "Status sem notificação" };
  const trackingUrl = `https://www.tionan.com.br/pedido.html?token=${encodeURIComponent(input.trackingToken)}`;
  const shortReference = input.reference.slice(0, 8).toUpperCase();
  const name = escapeHtml(input.name);
  const reason = String(input.reason || "").trim();
  const reasonHtml = input.status === "Cancelado" && reason
    ? `<div style="margin:20px 0;padding:16px;background:#f7f4ee;border-radius:12px;color:#667085"><strong style="color:#1b365d">Motivo:</strong> ${escapeHtml(reason)}</div>`
    : "";
  const reasonText = input.status === "Cancelado" && reason ? ` Motivo: ${reason}` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `pedido-status-${input.reference}-${input.status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` },
    body: JSON.stringify({
      from: "Tio Nan <pedidos@mail.tionan.com.br>",
      to: [input.email],
      subject: `${content.subject} — ${shortReference} | Tio Nan`,
      html: `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#1b365d"><div style="max-width:580px;margin:0 auto;padding:36px 18px"><div style="background:#fff;border-radius:18px;padding:34px;border:1px solid #e5e0d7"><div style="text-align:center;margin-bottom:26px"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="190" alt="Tio Nan" style="display:block;width:190px;max-width:70%;height:auto;margin:0 auto"></div><h1 style="font-size:25px;text-align:center;margin:0 0 14px">${content.title}</h1><p style="line-height:1.6;color:#667085">Olá, ${name}! ${content.message}</p><p style="line-height:1.6;color:#667085">Pedido <strong>${shortReference}</strong>.</p>${reasonHtml}<a href="${trackingUrl}" style="display:block;margin:28px 0;padding:17px;text-align:center;background:#1b365d;color:#fff;text-decoration:none;border:1px solid #c5a059;border-radius:12px;font-weight:800">ACOMPANHAR MEU PEDIDO</a><p style="font-size:13px;line-height:1.6;color:#8a8f98">Um abraço,<br><strong>Equipe Tio Nan</strong></p></div></div></body></html>`,
      text: `Olá, ${input.name}! ${content.message} Pedido ${shortReference}.${reasonText} Acompanhe em: ${trackingUrl} — Equipe Tio Nan`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, error: data?.message || "Falha no envio" };
}

export async function sendInvoiceEmail(input: { email: string; name: string; reference: string; invoiceNumber: string; pdfBase64: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY ausente" };
  const shortReference = input.reference.slice(0, 8).toUpperCase();
  const name = escapeHtml(input.name || "cliente");
  const invoiceNumber = escapeHtml(input.invoiceNumber || shortReference);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "Tio Nan <pedidos@mail.tionan.com.br>",
      to: [input.email],
      subject: `A nota fiscal do seu pedido chegou 🧾 | Tio Nan`,
      html: `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#1b365d"><div style="max-width:580px;margin:0 auto;padding:36px 18px"><div style="background:#fff;border-radius:18px;padding:34px;border:1px solid #e5e0d7"><div style="text-align:center;margin-bottom:26px"><img src="https://www.tionan.com.br/logo-tio-nan-email.png" width="190" alt="Tio Nan" style="display:block;width:190px;max-width:70%;height:auto;margin:0 auto"></div><h1 style="font-size:25px;text-align:center;margin:0 0 14px">Documento importante, sem perder o bom humor 🧾</h1><p style="line-height:1.6;color:#667085">Olá, ${name}! A nota fiscal <strong>${invoiceNumber}</strong> do pedido <strong>${escapeHtml(shortReference)}</strong> está prontinha e segue anexada a este e-mail.</p><p style="line-height:1.6;color:#667085">Pode guardar este documento — e deixar o brinde por nossa conta. 🥃</p><p style="font-size:13px;line-height:1.6;color:#8a8f98">Um abraço,<br><strong>Equipe Tio Nan</strong></p></div></div></body></html>`,
      text: `Olá, ${input.name || "cliente"}! A nota fiscal ${input.invoiceNumber || shortReference} do pedido ${shortReference} segue anexada. Um abraço, Equipe Tio Nan.`,
      attachments: [{ filename: `NF-e-${input.invoiceNumber || shortReference}.pdf`, content: input.pdfBase64 }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, error: data?.message || "Falha no envio da nota fiscal" };
}

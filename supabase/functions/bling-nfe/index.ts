import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendInvoiceEmail, sendOrderStatusUpdate } from "../_shared/order-email.ts";

const API_BASE = "https://api.bling.com.br/Api/v3";
const ALLOWED_NATURE_KEYS = new Set([
  "consumidor_final",
  "revenda_rs_normal",
  "revenda_rs_simples",
  "revenda_fora_rs_normal",
  "revenda_fora_rs_simples",
]);

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" && (url.hostname === "tionan.com.br" || url.hostname === "www.tionan.com.br" || url.hostname.endsWith(".vercel.app")))
      || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
};

const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && isAllowedOrigin(origin) ? origin : "https://www.tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" },
});

const natureIds = () => ({
  consumidor_final: Deno.env.get("BLING_NATURE_CONSUMIDOR_FINAL_ID") || "",
  revenda_rs_normal: Deno.env.get("BLING_NATURE_REVENDA_RS_NORMAL_ID") || "",
  revenda_rs_simples: Deno.env.get("BLING_NATURE_REVENDA_RS_SIMPLES_ID") || "",
  revenda_fora_rs_normal: Deno.env.get("BLING_NATURE_REVENDA_FORA_RS_NORMAL_ID") || "",
  revenda_fora_rs_simples: Deno.env.get("BLING_NATURE_REVENDA_FORA_RS_SIMPLES_ID") || "",
});

const fiscalEnvironment = () => {
  const value = String(Deno.env.get("BLING_NFE_ENVIRONMENT") || "").trim().toLowerCase();
  return value === "homologacao" || value === "producao" ? value : "";
};

const detailMessage = (data: any, status: number) => data?.error?.fields?.map?.((field: any) => `${field.element || "campo"}: ${field.msg || field.message || "inválido"}`).join("; ")
  || data?.error?.description || data?.message || `Erro Bling (${status})`;

const extractNfeId = (value: any): string => String(
  value?.data?.idNotaFiscal || value?.idNotaFiscal || value?.data?.id || value?.data?.notaFiscal?.id || value?.notaFiscal?.id || value?.id || "",
);

const saleUpdatePayload = (sale: any, natureId: string) => {
  const source = sale?.data || {};
  const allowedKeys = [
    "numero", "numeroLoja", "data", "dataSaida", "dataPrevista", "contato", "situacao", "loja",
    "numeroPedidoCompra", "outrasDespesas", "observacoes", "observacoesInternas", "desconto", "categoria",
    "tributacao", "parcelas", "transporte", "vendedor", "intermediador", "taxas",
  ];
  const payload: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined && source[key] !== null) payload[key] = source[key];
  }
  payload.dataSaida = source.dataSaida || source.data;
  payload.dataPrevista = source.dataPrevista || source.data;
  payload.itens = (Array.isArray(source.itens) ? source.itens : []).map((item: any) => ({
    ...item,
    naturezaOperacao: { id: Number(natureId) },
  }));
  payload.parcelas = Array.isArray(source.parcelas) ? source.parcelas : [];
  return payload;
};

const extractSaleNfeId = (sale: any): string => String(
  sale?.data?.notaFiscal?.id || sale?.data?.nfe?.id || sale?.data?.notasFiscais?.[0]?.id || "",
);

const extractUf = (order: any, sale: any) => {
  const candidates = [
    sale?.data?.transporte?.etiqueta?.uf,
    sale?.data?.contato?.endereco?.geral?.uf,
  ];
  for (const candidate of candidates) {
    const uf = String(candidate || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(uf)) return uf;
  }
  const match = String(order?.endereco || "").toUpperCase().match(/(?:,|\s)([A-Z]{2})(?:\s|,|$)/);
  return match?.[1] || "";
};

const isAuthorizedNote = (status: unknown) => [5, 6].includes(Number(status));

const publicNote = (note: any) => {
  const data = note?.data || note || {};
  return {
    id: String(data.id || ""),
    numero: String(data.numero || ""),
    serie: String(data.serie || ""),
    situacao: String(data.situacao ?? ""),
    chave_acesso: String(data.chaveAcesso || ""),
    data_emissao: data.dataEmissao || null,
    tem_danfe: isAuthorizedNote(data.situacao) && Boolean(data.chaveAcesso),
    tem_xml: isAuthorizedNote(data.situacao) && Boolean(data.chaveAcesso),
  };
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Use POST." }, 405);
  if (!isAllowedOrigin(origin)) return json(origin, { error: "Origem não autorizada." }, 403);

  const authorization = request.headers.get("authorization") || "";
  const userToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!userToken) return json(origin, { error: "Entre novamente no painel administrativo." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: authData, error: authError } = await db.auth.getUser(userToken);
  if (authError || !authData.user) return json(origin, { error: "Sessão administrativa inválida." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (!admin) return json(origin, { error: "Acesso administrativo necessário." }, 403);

  const input = await request.json().catch(() => ({}));
  const action = String(input.action || "");
  const pedidoId = String(input.pedido_id || "");
  if (!pedidoId || !["revisar", "emitir", "consultar", "documento", "enviar_email", "cancelar_pedido"].includes(action)) {
    return json(origin, { error: "Ação ou pedido inválido." }, 400);
  }

  const { data: order, error: orderError } = await db.from("pedidos")
    .select("id,referencia,status,bling_id,bling_nfe_id,bling_nfe_status,bling_nfe_numero,bling_nfe_chave_acesso,bling_nfe_natureza_chave,bling_estoque_lancado_em,estoque_estornado_em,cliente_nome,cliente_email,cliente_cpf,cliente_telefone,tracking_token,endereco,itens_json,total,frete,pagamento,status_pagamento")
    .eq("id", pedidoId).single();
  if (orderError || !order) return json(origin, { error: "Pedido não encontrado." }, 404);
  if (!order.bling_id) return json(origin, { error: "Sincronize este pedido com o Bling antes de emitir a NF-e." }, 409);

  const { data: connection, error: connectionError } = await db.from("bling_integracao")
    .select("access_token,refresh_token,expires_at").eq("id", "principal").single();
  if (connectionError || !connection?.access_token) return json(origin, { error: "Bling ainda não está conectado." }, 409);

  let accessToken = connection.access_token;
  if (connection.expires_at && new Date(connection.expires_at) <= new Date(Date.now() + 60_000)) {
    const clientId = Deno.env.get("BLING_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET") || "";
    if (!clientId || !clientSecret) return json(origin, { error: "OAuth do Bling não está configurado no servidor." }, 500);
    const refresh = await fetch(`${API_BASE}/oauth/token`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded", "enable-jwt": "1" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refresh_token }),
    });
    const token = await refresh.json().catch(() => ({}));
    if (!refresh.ok) return json(origin, { error: "Não foi possível renovar a conexão com o Bling." }, 401);
    accessToken = token.access_token;
    await db.from("bling_integracao").update({
      access_token: token.access_token,
      refresh_token: token.refresh_token || connection.refresh_token,
      expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq("id", "principal");
  }

  const bling = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "enable-jwt": "1", ...(init.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fail = (message: string) => {
        const error = new Error(message) as Error & { status?: number };
        error.status = response.status;
        throw error;
      };
      if (response.status === 401) {
        fail("A conexão com o Bling expirou ou foi revogada. Reconecte o aplicativo no painel para autorizar as novas permissões.");
      }
      if (response.status === 403) {
        const method = String(init.method || "GET").toUpperCase();
        if (path.includes("/gerar-nfe") || path.startsWith("/nfe/")) {
          fail("Acesso negado pelo Bling: adicione ao aplicativo os escopos de Nota Fiscal (consultar, incluir/gerenciar e enviar) e conecte o aplicativo novamente.");
        }
        if (path.startsWith("/pedidos/vendas/") && method === "PUT") {
          fail("Acesso negado pelo Bling: falta o escopo para gerenciar/alterar Pedidos de Venda. Adicione essa permissão ao aplicativo e conecte-o novamente.");
        }
        fail("Acesso negado pelo Bling: o aplicativo não possui o escopo necessário para esta operação. Atualize os escopos e conecte-o novamente.");
      }
      fail(detailMessage(data, response.status));
    }
    return data;
  };

  const persistNote = async (raw: any, natureKey?: string) => {
    const note = publicNote(raw);
    const update: Record<string, unknown> = {
      bling_nfe_id: note.id || order.bling_nfe_id || null,
      bling_nfe_status: note.situacao || "gerada",
      bling_nfe_numero: note.numero || null,
      bling_nfe_chave_acesso: note.chave_acesso || null,
      bling_nfe_ultima_consulta_em: new Date().toISOString(),
      bling_nfe_erro: null,
    };
    if (natureKey) update.bling_nfe_natureza_chave = natureKey;
    await db.from("pedidos").update(update).eq("id", order.id);
    return note;
  };

  try {
    let sale: any = null;
    try {
      sale = await bling(`/pedidos/vendas/${encodeURIComponent(String(order.bling_id))}`);
    } catch (error) {
      if (action !== "cancelar_pedido" || Number((error as { status?: number })?.status) !== 404) throw error;
      // O pedido já foi removido no Bling. O cancelamento local ainda deve ser
      // concluído, sem tentar movimentar novamente um recurso inexistente.
    }
    const destinoUf = extractUf(order, sale);
    const configured = natureIds();
    const environment = fiscalEnvironment();

    if (action === "cancelar_pedido") {
      const motivo = String(input.motivo || "").trim();
      if (motivo.length < 5) return json(origin, { error: "Informe um motivo com pelo menos 5 caracteres." }, 400);
      if (order.status === "Cancelado" && order.estoque_estornado_em) {
        return json(origin, { ok: true, ja_cancelado: true, estoque_estornado: true });
      }

      let noteId = String(order.bling_nfe_id || extractSaleNfeId(sale));
      let note: any = null;
      if (noteId) {
        try {
          note = publicNote(await bling(`/nfe/${encodeURIComponent(noteId)}`));
          if (String(note.situacao) !== "2") {
            return json(origin, {
              error: "A NF-e ainda está ativa. Cancele a NF-e em Vendas > Notas Fiscais de Saída no Bling e, depois que ela aparecer como Cancelada, clique novamente em CANCELAR PEDIDO E ESTORNAR. Nenhum estoque foi alterado.",
              requer_cancelamento_manual_nfe: true,
              nota_id: noteId,
              nota_numero: note.numero || order.bling_nfe_numero || null,
            }, 409);
          }
        } catch (error) {
          if (Number((error as { status?: number })?.status) !== 404) throw error;
          // Uma NF-e excluída deixa de ser consultável. Isso não deve bloquear o
          // estorno local do pedido que ainda existe no painel.
          noteId = "";
        }
      }

      if (sale && order.bling_estoque_lancado_em) {
        try {
          await bling(`/pedidos/vendas/${encodeURIComponent(String(order.bling_id))}/estornar-estoque`, { method: "POST" });
        } catch (error) {
          if (Number((error as { status?: number })?.status) !== 404) throw error;
        }
      }
      const { data: stockResult, error: stockError } = await db.rpc("estornar_estoque_pedido_cancelado", { p_pedido: order.id });
      if (stockError) throw new Error(`A nota foi cancelada, mas o estoque local não pôde ser estornado: ${stockError.message}`);
      const { error: packageError } = await db.rpc("estornar_embalagem_pdv", { p_pedido_id: order.id });
      if (packageError) throw new Error(`As garrafas foram estornadas, mas a embalagem não pôde ser devolvida: ${packageError.message}`);
      const now = new Date().toISOString();
      const { error: cancelError } = await db.from("pedidos").update({
        status: "Cancelado",
        cancelado_em: now,
        cancelado_por: authData.user.id,
        motivo_cancelamento: motivo,
        bling_cancelado_em: now,
        bling_nfe_id: noteId || order.bling_nfe_id || null,
        bling_nfe_status: note?.situacao || order.bling_nfe_status,
        atualizado_em: now,
      }).eq("id", order.id);
      if (cancelError) throw new Error(`Operações externas concluídas, mas não foi possível atualizar o pedido: ${cancelError.message}`);
      let emailEnviado = false;
      let emailErro: string | null = null;
      if (order.cliente_email && order.tracking_token) {
        const emailResult = await sendOrderStatusUpdate({ email: order.cliente_email, name: order.cliente_nome || "Cliente Tio Nan", reference: order.referencia, trackingToken: String(order.tracking_token), status: "Cancelado", reason: motivo });
        emailEnviado = Boolean(emailResult.ok);
        if (!emailResult.ok && !emailResult.skipped) emailErro = emailResult.error || "Falha no envio";
      }
      return json(origin, { ok: true, nota_cancelada: Boolean(noteId), estoque_estornado: true, estoque: stockResult, email_enviado: emailEnviado, email_erro: emailErro });
    }

    if (action === "revisar") {
      const compradorTipo = String(input.comprador_tipo || "consumidor");
      const regime = String(input.regime_tributario || "normal") === "simples" ? "simples" : "normal";
      const suggested = compradorTipo === "revendedor"
        ? `revenda_${destinoUf === "RS" ? "rs" : "fora_rs"}_${regime}`
        : "consumidor_final";
      return json(origin, {
        ok: true,
        pedido: {
          referencia: order.referencia,
          nome: order.cliente_nome,
          email: order.cliente_email,
          cpf: order.cliente_cpf,
          telefone: order.cliente_telefone,
          endereco: order.endereco,
          destino_uf: destinoUf,
          itens: Array.isArray(order.itens_json) ? order.itens_json.map((item: any) => ({ nome: item.nome, quantidade: item.quantidade, preco: item.preco })) : [],
          total: Number(order.total || 0),
          frete: Number(order.frete || 0),
          pagamento: order.pagamento,
        },
        natureza_sugerida: suggested,
        ambiente_fiscal: environment || "nao_configurado",
        naturezas_configuradas: Object.fromEntries(Object.entries(configured).map(([key, value]) => [key, Boolean(value)])),
        nota: order.bling_nfe_id ? {
          id: order.bling_nfe_id,
          numero: order.bling_nfe_numero,
          situacao: order.bling_nfe_status,
          chave_acesso: order.bling_nfe_chave_acesso,
          tem_danfe: isAuthorizedNote(order.bling_nfe_status) && Boolean(order.bling_nfe_chave_acesso),
          tem_xml: isAuthorizedNote(order.bling_nfe_status) && Boolean(order.bling_nfe_chave_acesso),
        } : null,
      });
    }

    let noteId = String(order.bling_nfe_id || extractSaleNfeId(sale));
    if (action === "emitir") {
      if (!environment) return json(origin, { error: "O ambiente fiscal não foi configurado no backend. A emissão foi bloqueada por segurança." }, 409);
      if (String(input.confirmar_ambiente || "") !== environment) {
        return json(origin, { error: "Confirme explicitamente o ambiente fiscal exibido antes de emitir." }, 409);
      }
      const natureKey = String(input.natureza_chave || "");
      if (!ALLOWED_NATURE_KEYS.has(natureKey)) return json(origin, { error: "Selecione uma das quatro naturezas permitidas." }, 400);
      const natureId = configured[natureKey as keyof typeof configured];
      if (!natureId || !/^\d+$/.test(natureId)) return json(origin, { error: "Essa natureza ainda não foi configurada no servidor." }, 409);

      if (!noteId) {
        // O Bling altera pedidos de venda com PUT. A natureza pertence a cada
        // item do pedido; enviamos novamente os dados atuais, mudando somente ela.
        await bling(`/pedidos/vendas/${encodeURIComponent(String(order.bling_id))}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(saleUpdatePayload(sale, natureId)),
        });
        const generated = await bling(`/pedidos/vendas/${encodeURIComponent(String(order.bling_id))}/gerar-nfe`, { method: "POST" });
        noteId = extractNfeId(generated);
        if (!noteId) throw new Error("O Bling gerou a nota, mas não retornou seu identificador. Consulte o pedido no Bling antes de tentar novamente.");
        await db.from("pedidos").update({ bling_nfe_id: noteId, bling_nfe_natureza_chave: natureKey, bling_nfe_status: "gerada", bling_nfe_erro: null }).eq("id", order.id);
      }

      // O e-mail automático do Bling não permite controlar com segurança o
      // destinatário nem o texto. A NF-e é emitida sem e-mail e, após
      // autorizada, o botão próprio envia o DANFE ao endereço do pedido.
      await bling(`/nfe/${encodeURIComponent(noteId)}/enviar?enviarEmail=false`, { method: "POST" });
      const noteResult = await bling(`/nfe/${encodeURIComponent(noteId)}`);
      const note = await persistNote(noteResult, natureKey);
      return json(origin, { ok: true, nota: note });
    }

    if (!noteId) return json(origin, { error: "Este pedido ainda não possui NF-e no Bling." }, 404);
    if (action === "enviar_email") {
      const recipient = String(order.cliente_email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        return json(origin, { error: "O pedido não possui e-mail para receber a NF-e." }, 422);
      }
      const emailedResult = await bling(`/nfe/${encodeURIComponent(noteId)}`);
      const emailedNote = await persistNote(emailedResult);
      if (!emailedNote.chave_acesso || !isAuthorizedNote(emailedNote.situacao)) {
        return json(origin, { error: "A NF-e ainda não está autorizada e não possui DANFE disponível." }, 409);
      }
      const documentResponse = await fetch(`${API_BASE}/nfe/documento/${encodeURIComponent(emailedNote.chave_acesso)}?formato=pdf`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/pdf", "enable-jwt": "1" },
      });
      if (!documentResponse.ok) {
        const detail = await documentResponse.json().catch(() => ({}));
        throw new Error(detailMessage(detail, documentResponse.status));
      }
      const documentJson = await documentResponse.json().catch(() => ({}));
      const documentItem = Array.isArray(documentJson?.data) ? documentJson.data[0] : null;
      const encoded = String(documentItem?.conteudo || "");
      if (!encoded) throw new Error("O Bling não retornou o DANFE da NF-e.");
      const compressed = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      let pdfBytes: Uint8Array;
      try {
        const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        pdfBytes = new Uint8Array(buffer);
      } catch {
        throw new Error("Não foi possível preparar o DANFE para o e-mail.");
      }
      const emailResult = await sendInvoiceEmail({
        email: recipient,
        name: String(order.cliente_nome || "Cliente Tio Nan"),
        reference: String(order.referencia || ""),
        invoiceNumber: String(emailedNote.numero || ""),
        pdfBase64: bytesToBase64(pdfBytes),
      });
      if (!emailResult.ok) throw new Error(emailResult.error || "Não foi possível enviar a NF-e por e-mail.");
      return json(origin, { ok: true, email: recipient, nota: emailedNote });
    }
    const noteResult = await bling(`/nfe/${encodeURIComponent(noteId)}`);
    const note = await persistNote(noteResult);

    if (action === "consultar") return json(origin, { ok: true, nota: note });
    const formato = String(input.formato || "").toLowerCase();
    if (!new Set(["pdf", "xml"]).has(formato)) return json(origin, { error: "Formato inválido." }, 400);
    if (!note.chave_acesso) return json(origin, { error: "O documento ainda não possui chave de acesso. Aguarde a autorização da NF-e e consulte novamente." }, 409);
    const documentResponse = await fetch(`${API_BASE}/nfe/documento/${encodeURIComponent(note.chave_acesso)}?formato=${formato}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: formato === "pdf" ? "application/pdf" : "application/xml", "enable-jwt": "1" },
    });
    if (!documentResponse.ok) {
      const detail = await documentResponse.json().catch(() => ({}));
      throw new Error(detailMessage(detail, documentResponse.status));
    }
    // O Bling retorna JSON com o documento comprimido em GZIP e codificado em
    // base64. Convertemos no servidor para entregar um PDF/XML verdadeiro.
    const documentJson = await documentResponse.json().catch(() => ({}));
    const documentItem = Array.isArray(documentJson?.data) ? documentJson.data[0] : null;
    const encoded = String(documentItem?.conteudo || "");
    if (!encoded) throw new Error(`O Bling não retornou o conteúdo do ${formato.toUpperCase()}.`);
    let compressed: Uint8Array;
    try {
      compressed = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
      throw new Error(`O Bling retornou um ${formato.toUpperCase()} inválido.`);
    }
    let documentBytes: ArrayBuffer;
    try {
      documentBytes = await new Response(
        new Blob([compressed.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
    } catch {
      throw new Error(`Não foi possível descompactar o ${formato.toUpperCase()} retornado pelo Bling.`);
    }
    return new Response(documentBytes, {
      status: 200,
      headers: {
        ...cors(origin),
        "content-type": formato === "pdf" ? "application/pdf" : "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="NFe-${note.numero || order.referencia}.${formato}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na integração fiscal com o Bling.";
    await db.from("pedidos").update({ bling_nfe_erro: message, bling_nfe_ultima_consulta_em: new Date().toISOString() }).eq("id", order.id);
    return json(origin, { error: message }, 422);
  }
});

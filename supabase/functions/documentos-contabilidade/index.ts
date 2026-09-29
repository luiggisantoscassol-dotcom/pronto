import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zipSync } from "npm:fflate@0.8.2";

const RESEND_API = "https://api.resend.com";
const BLING_API = "https://api.bling.com.br/Api/v3";
const BUCKET = "notas-compra";
const LIMITE_ZIP = 45 * 1024 * 1024;
const LIMITE_EMAIL = 22 * 1024 * 1024;

const origemPermitida = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "tionan.com.br" || host === "www.tionan.com.br" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
      ? origin : "https://www.tionan.com.br";
  } catch { return "https://www.tionan.com.br"; }
};
const cors = (request: Request) => ({
  "access-control-allow-origin": origemPermitida(request),
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "Origin",
});
const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors(request), "content-type": "application/json; charset=utf-8" },
});
const emailValido = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const nomeSeguro = (value: unknown) => String(value || "documento")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "documento";
const PASTAS_POR_TIPO: Record<string, string> = {
  nota_fiscal: "01_Notas_Fiscais_NFe",
  xml_nfe: "02_XML_NFe",
  danfe: "03_DANFE",
  nfse: "04_Notas_Fiscais_Servico_NFSe",
  comprovante_bancario: "05_Comprovantes_Bancarios",
  comprovante_pix: "06_Comprovantes_PIX",
  boleto: "07_Boletos",
  recibo: "08_Recibos",
  outro: "09_Outros_Documentos",
};
const pastaDocumento = (tipo: unknown) => PASTAS_POR_TIPO[String(tipo || "")] || "09_Outros_Documentos";
const base64 = (bytes: Uint8Array) => {
  let resultado = "";
  for (let i = 0; i < bytes.length; i += 0x8000) resultado += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(resultado);
};
const detalheBling = (data: any, status: number) => data?.error?.fields?.map?.((field: any) => `${field.element || "campo"}: ${field.msg || field.message || "inválido"}`).join("; ")
  || data?.error?.description || data?.message || `Erro Bling (${status})`;
const acessoBling = async (db: any) => {
  const { data: connection, error } = await db.from("bling_integracao")
    .select("access_token,refresh_token,expires_at").eq("id", "principal").single();
  if (error || !connection?.access_token) throw new Error("O Bling precisa estar conectado para incluir os XML das NF-e dos pedidos.");
  if (!connection.expires_at || new Date(connection.expires_at) > new Date(Date.now() + 60_000)) return connection.access_token;
  const clientId = Deno.env.get("BLING_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BLING_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) throw new Error("OAuth do Bling não está configurado no servidor.");
  const resposta = await fetch(`${BLING_API}/oauth/token`, {
    method:"POST",
    headers:{ authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`, "content-type":"application/x-www-form-urlencoded", "enable-jwt":"1" },
    body:new URLSearchParams({ grant_type:"refresh_token", refresh_token:connection.refresh_token }),
  });
  const token = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !token.access_token) throw new Error("Não foi possível renovar a conexão com o Bling para obter os XML.");
  await db.from("bling_integracao").update({
    access_token:token.access_token,
    refresh_token:token.refresh_token || connection.refresh_token,
    expires_at:new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
    atualizado_em:new Date().toISOString(),
  }).eq("id", "principal");
  return token.access_token;
};
const baixarXmlNfe = async (accessToken: string, chave: string) => {
  const resposta = await fetch(`${BLING_API}/nfe/documento/${encodeURIComponent(chave)}?formato=xml`, {
    headers:{ authorization:`Bearer ${accessToken}`, accept:"application/xml", "enable-jwt":"1" },
  });
  const retorno = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(detalheBling(retorno, resposta.status));
  const item = Array.isArray(retorno?.data) ? retorno.data[0] : null;
  const encoded = String(item?.conteudo || "");
  if (!encoded) throw new Error("O Bling não retornou o conteúdo do XML.");
  let compactado: Uint8Array;
  try { compactado = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)); }
  catch { throw new Error("O Bling retornou um XML inválido."); }
  try {
    const buffer = await new Response(new Blob([compactado.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return new Uint8Array(buffer);
  } catch { throw new Error("Não foi possível descompactar o XML retornado pelo Bling."); }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: erroAuth } = await db.auth.getUser(token);
  if (erroAuth || !auth.user) return json(request, { error: "Faça login novamente no painel." }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (!admin) return json(request, { error: "Acesso restrito ao administrador." }, 403);

  const entrada = await request.json().catch(() => ({}));
  const acao = String(entrada.action || "");
  const modo = String(entrada.mode || "new");
  const competencia = String(entrada.competencia || "");
  if (!["download", "send"].includes(acao) || !/^\d{4}-\d{2}$/.test(competencia)) return json(request, { error: "Ação ou competência inválida." }, 400);
  const competenciaData = `${competencia}-01`;
  let consultaDocumentos = db.from("documentos_contabeis")
    .select("id,tipo_codigo,data_documento,descricao,arquivo_path,arquivo_nome,arquivo_bytes")
    .eq("competencia", competenciaData).order("data_documento").order("criado_em");
  if (acao === "send" && modo !== "all") consultaDocumentos = consultaDocumentos.neq("status", "enviado_contabilidade");
  const { data: documentos, error: erroDocumentos } = await consultaDocumentos;
  if (erroDocumentos) return json(request, { error: erroDocumentos.message }, 500);
  const { data: pedidosComNfe, error: erroPedidos } = await db.from("pedidos")
    .select("id,referencia,tipo_operacao,created_at,bling_nfe_id,bling_nfe_status,bling_nfe_numero,bling_nfe_serie,bling_nfe_data_emissao,bling_nfe_chave_acesso")
    .in("bling_nfe_status", ["5", "6"]).not("bling_nfe_chave_acesso", "is", null)
    .neq("status", "Cancelado")
    .order("bling_nfe_data_emissao", { ascending:true, nullsFirst:false });
  if (erroPedidos) return json(request, { error:erroPedidos.message }, 500);
  const notasPedidos = (pedidosComNfe || []).filter((pedido: any) => String(pedido.bling_nfe_data_emissao || pedido.created_at || "").slice(0, 7) === competencia);
  if (!documentos?.length && !notasPedidos.length) return json(request, { error: acao === "send" && modo !== "all" ? "Não há documentos novos nem XML de pedidos para enviar neste mês." : "Esta competência ainda não possui documentos." }, 409);
  const totalOriginal = documentos.reduce((soma, item) => soma + Number(item.arquivo_bytes || 0), 0);
  if (totalOriginal > LIMITE_ZIP) return json(request, { error: "Os documentos ultrapassam 45 MB. Faça o download em grupos menores." }, 413);

  let destinatario = "";
  let envioId = "";
  if (acao === "send") {
    const { data: config } = await db.from("documentos_contabeis_config").select("email_contador").eq("id", true).maybeSingle();
    destinatario = String(config?.email_contador || "").trim().toLowerCase();
    if (!emailValido(destinatario)) return json(request, { error: "Configure um e-mail válido da contabilidade." }, 409);
    const { data: envio, error: erroEnvio } = await db.from("documentos_contabeis_envios").insert({
      competencia: competenciaData, destinatario, quantidade_documentos: documentos.length + notasPedidos.length,
      documento_ids: documentos.map((item) => item.id), status: "processando", criado_por: auth.user.id,
    }).select("id").single();
    if (erroEnvio) return json(request, { error: erroEnvio.message }, 500);
    envioId = envio.id;
  }

  try {
    const arquivos: Record<string, Uint8Array> = {};
    for (const [indice, documento] of documentos.entries()) {
      const { data, error } = await db.storage.from(BUCKET).download(documento.arquivo_path);
      if (error || !data) throw new Error(`Não foi possível acessar ${documento.arquivo_nome}: ${error?.message || "arquivo ausente"}`);
      const prefixo = `${String(indice + 1).padStart(3, "0")}_${documento.data_documento}_${documento.tipo_codigo}`;
      const descricao = documento.descricao ? `_${nomeSeguro(documento.descricao).slice(0, 60)}` : "";
      arquivos[`${pastaDocumento(documento.tipo_codigo)}/${prefixo}${descricao}_${nomeSeguro(documento.arquivo_nome)}`] = new Uint8Array(await data.arrayBuffer());
    }
    if (notasPedidos.length) {
      const accessToken = await acessoBling(db);
      for (const [indice, pedido] of notasPedidos.entries()) {
        try {
          const xml = await baixarXmlNfe(accessToken, String(pedido.bling_nfe_chave_acesso));
          const numero = nomeSeguro(pedido.bling_nfe_numero || pedido.bling_nfe_id || String(indice + 1));
          const referencia = nomeSeguro(pedido.referencia || pedido.id).slice(0, 60);
          const subpasta = pedido.tipo_operacao === "brinde" ? "02_Brindes" : "01_Vendas";
          arquivos[`10_XML_NFe_Pedidos_Emitidos/${subpasta}/${String(indice + 1).padStart(3, "0")}_NFe-${numero}_Pedido-${referencia}.xml`] = xml;
        } catch (error) {
          const numero = pedido.bling_nfe_numero || pedido.bling_nfe_id || pedido.referencia || pedido.id;
          throw new Error(`Não foi possível obter o XML da NF-e ${numero}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const zip = zipSync(arquivos, { level: 6 });
    if (zip.byteLength > LIMITE_ZIP) throw new Error("O ZIP completo, incluindo os XML dos pedidos, ultrapassa 45 MB.");
    const nomeZip = `Tio-Nan_Documentos_${competencia}.zip`;
    if (acao === "download") return new Response(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, {
      status: 200,
      headers: { ...cors(request), "content-type": "application/zip", "content-disposition": `attachment; filename="${nomeZip}"`, "content-length": String(zip.byteLength) },
    });
    if (zip.byteLength > LIMITE_EMAIL) throw new Error("O ZIP ultrapassa o limite seguro de 22 MB para envio por e-mail. Use o download manual.");
    const apiKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!apiKey) throw new Error("RESEND_API_KEY não configurada.");
    const from = Deno.env.get("RESEND_FROM_CONTABILIDADE") || "Tio Nan — Contabilidade <contabilidade@mail.tionan.com.br>";
    const resposta = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `contabilidade-${envioId}` },
      body: JSON.stringify({
        from, to: [destinatario], subject: `Documentos contábeis Tio Nan — ${competencia}`,
        html: `<div style="font-family:Arial,sans-serif;color:#17304f;max-width:620px;margin:auto"><h1 style="font-family:Georgia,serif">Documentos contábeis — ${competencia}</h1><p>Seguem anexos os ${documentos.length} documentos arquivados e ${notasPedidos.length} XML de NF-e emitida em pedidos pela Tio Nan para esta competência.</p><p style="color:#6b7280;font-size:13px">Os XML estão em 10_XML_NFe_Pedidos_Emitidos, separados entre vendas e brindes.</p><p style="color:#6b7280;font-size:13px">Envio automático do painel administrativo Tio Nan.</p></div>`,
        text: `Seguem anexos ${documentos.length} documentos contábeis e ${notasPedidos.length} XML de NF-e de pedidos da Tio Nan para a competência ${competencia}.`,
        attachments: [{ filename: nomeZip, content: base64(zip) }],
      }),
    });
    const retorno = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(String(retorno?.message || retorno?.error || `Erro Resend (${resposta.status})`));
    const agora = new Date().toISOString();
    await Promise.all([
      db.from("documentos_contabeis_envios").update({ status:"enviado", resend_id:retorno.id || null, enviado_em:agora }).eq("id", envioId),
      documentos.length ? db.from("documentos_contabeis").update({ status:"enviado_contabilidade", enviado_contabilidade_em:agora, atualizado_em:agora }).in("id", documentos.map((item) => item.id)) : Promise.resolve(),
    ]);
    return json(request, { ok:true, quantidade:documentos.length + notasPedidos.length, quantidade_documentos:documentos.length, quantidade_xml_pedidos:notasPedidos.length, enviado_em:agora, resend_id:retorno.id || null });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    if (envioId) await db.from("documentos_contabeis_envios").update({ status:"erro", erro:mensagem }).eq("id", envioId);
    return json(request, { error:mensagem }, 502);
  }
});

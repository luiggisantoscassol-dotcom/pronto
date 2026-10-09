import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "notas-compra";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_POR_15_MINUTOS = 30;
const TIPOS: Record<string, string> = {
  "nota fiscal (nf-e)": "nota_fiscal", "nota fiscal": "nota_fiscal", "nfe": "nota_fiscal", "nota_fiscal": "nota_fiscal",
  "xml de nf-e": "xml_nfe", "xml nfe": "xml_nfe", "xml": "xml_nfe", "xml_nfe": "xml_nfe",
  "danfe": "danfe", "nfs-e": "nfse", "nfse": "nfse",
  "comprovante bancario": "comprovante_bancario", "comprovante_bancário": "comprovante_bancario", "comprovante_bancario": "comprovante_bancario",
  "comprovante pix": "comprovante_pix", "pix": "comprovante_pix", "comprovante_pix": "comprovante_pix",
  "boleto": "boleto", "recibo": "recibo", "outro": "outro",
};
const NOMES_TIPOS: Record<string, string> = {
  nota_fiscal:"Nota Fiscal", xml_nfe:"XML de NF-e", danfe:"DANFE", nfse:"NFS-e",
  comprovante_bancario:"Comprovante bancário", comprovante_pix:"Comprovante PIX",
  boleto:"Boleto", recibo:"Recibo", outro:"Documento",
};

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
  "access-control-allow-headers": "authorization, apikey, content-type, x-tio-nan-token, x-idempotency-key, x-file-name, x-document-type, x-document-date, x-document-competence, x-document-description",
  "access-control-allow-methods": "POST, OPTIONS", "vary": "Origin",
});
const json = (request: Request, body: unknown, status = 200) => {
  const payload = body && typeof body === "object" && "error" in body && !("message" in body)
    ? { ...body, message:String((body as { error:unknown }).error || "Não foi possível enviar o documento.") } : body;
  return new Response(JSON.stringify(payload), {
  status, headers: { ...cors(request), "content-type": "application/json; charset=utf-8" },
  });
};
const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const hashTexto = async (valor: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor))));
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const nomeSeguro = (valor: unknown) => String(valor || "documento")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100) || "documento";
const nomeExibicaoSeguro = (valor: unknown) => String(valor || "Documento")
  .normalize("NFC").replace(/[\\/:*?"<>|#\u0000-\u001f]+/g, "-")
  .replace(/\s+/g, " ").replace(/-+/g, "-").trim().slice(0, 120) || "Documento";
const decodificar = (valor: string | null) => {
  let texto = valor || "";
  try { texto = decodeURIComponent(texto); } catch { /* O cabeçalho pode não estar percent-encoded. */ }
  // O Atalhos do iPhone pode enviar UTF-8 em um cabeçalho interpretado como
  // Latin-1 pela camada HTTP ("rótulos" chega como "rÃ³tulos"). Só tentamos
  // recuperar quando aparecem os marcadores clássicos de mojibake; com
  // TextDecoder fatal, palavras legítimas como "Ângela" permanecem intactas.
  if (/[ÃÂâï]/.test(texto)) {
    try {
      const bytes = Uint8Array.from([...texto].map((caractere) => caractere.charCodeAt(0)));
      texto = new TextDecoder("utf-8", { fatal:true }).decode(bytes);
    } catch { /* Mantém o valor original se ele não representar UTF-8 válido. */ }
  }
  return texto.normalize("NFC");
};
const normalizar = (valor: unknown) => String(valor || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tipoCodigo = (valor: unknown) => TIPOS[String(valor || "").trim().toLowerCase()] || TIPOS[normalizar(valor)] || "";
const bytesIguais = (bytes: Uint8Array, assinatura: number[], inicio = 0) => assinatura.every((valor, indice) => bytes[inicio + indice] === valor);

function identificarArquivo(bytes: Uint8Array) {
  if (!bytes.length) throw new Error("O arquivo recebido está vazio.");
  if (bytes.length > MAX_BYTES) throw new Error("O arquivo deve ter no máximo 15 MB.");
  if (bytesIguais(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime:"application/pdf", extensao:"pdf" };
  if (bytesIguais(bytes, [0xff, 0xd8, 0xff])) return { mime:"image/jpeg", extensao:"jpg" };
  if (bytesIguais(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime:"image/png", extensao:"png" };
  if (bytesIguais(bytes, [0x52, 0x49, 0x46, 0x46]) && bytesIguais(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { mime:"image/webp", extensao:"webp" };
  const texto = new TextDecoder("utf-8", { fatal:false }).decode(bytes.subarray(0, Math.min(bytes.length, 4096))).replace(/^\uFEFF/, "").trimStart();
  if (/^<\?xml\b/i.test(texto) || /^<(nfeProc|NFe|CompNfse|ConsultarNfseResposta)\b/i.test(texto)) return { mime:"application/xml", extensao:"xml" };
  throw new Error("Formato inválido. Envie XML, PDF, JPG, JPEG, PNG ou WebP.");
}

function hojeSaoPaulo() {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const valor = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${valor.year}-${valor.month}-${valor.day}`;
}

async function autenticarAdmin(request: Request, db: any) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth.user) return null;
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  return admin ? auth.user : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers:cors(request) });
  if (request.method !== "POST") return json(request, { error:"Use POST." }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const admin = await autenticarAdmin(request, db);
    if (!admin) return json(request, { error:"Acesso restrito ao administrador." }, 401);
    const entrada = await request.json().catch(() => ({}));
    const action = String(entrada.action || "");
    if (action === "list-devices") {
      const { data, error } = await db.from("documentos_atalho_dispositivos")
        .select("id,nome,token_prefix,ativo,criado_em,ultimo_uso_em,revogado_em")
        .eq("user_id", admin.id).order("criado_em", { ascending:false });
      return error ? json(request, { error:error.message }, 500) : json(request, { devices:data || [] });
    }
    if (action === "create-device") {
      const nome = String(entrada.nome || "iPhone").trim().slice(0, 80);
      if (nome.length < 2) return json(request, { error:"Informe um nome para o iPhone." }, 400);
      const segredo = new Uint8Array(32); crypto.getRandomValues(segredo);
      const token = `tnios_${base64Url(segredo)}`;
      const tokenHash = await hashTexto(token);
      const { data, error } = await db.from("documentos_atalho_dispositivos").insert({
        nome, token_hash:tokenHash, token_prefix:token.slice(0, 12), user_id:admin.id,
      }).select("id,nome,token_prefix,ativo,criado_em,ultimo_uso_em").single();
      return error ? json(request, { error:error.message }, 500) : json(request, {
        device:data, token, upload_url:`${Deno.env.get("SUPABASE_URL")}/functions/v1/documentos-atalho-iphone`,
        warning:"Copie agora. Este token não será exibido novamente.",
      });
    }
    if (action === "revoke-device") {
      const id = String(entrada.id || "");
      const { error } = await db.from("documentos_atalho_dispositivos").update({ ativo:false, revogado_em:new Date().toISOString() }).eq("id", id).eq("user_id", admin.id);
      return error ? json(request, { error:error.message }, 500) : json(request, { ok:true });
    }
    return json(request, { error:"Ação inválida." }, 400);
  }

  const token = request.headers.get("x-tio-nan-token") || "";
  if (!/^tnios_[A-Za-z0-9_-]{40,}$/.test(token)) return json(request, { error:"Acesso do iPhone inválido. Gere uma nova conexão no painel." }, 401);
  const tokenHash = await hashTexto(token);
  const { data: dispositivo } = await db.from("documentos_atalho_dispositivos")
    .select("id,nome,user_id,ativo").eq("token_hash", tokenHash).eq("ativo", true).maybeSingle();
  if (!dispositivo) return json(request, { error:"Acesso do iPhone inválido ou revogado." }, 401);
  await db.from("documentos_atalho_dispositivos").update({ ultimo_uso_em:new Date().toISOString() }).eq("id", dispositivo.id);

  const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await db.from("documentos_contabeis").select("id", { count:"exact", head:true })
    .eq("origem_tipo", "atalho_ios").like("origem_id", `${dispositivo.id}:%`).gte("criado_em", desde);
  if (Number(count || 0) >= MAX_POR_15_MINUTOS) return json(request, { error:"Muitos envios em sequência. Aguarde alguns minutos." }, 429);

  let arquivo: File | null = null;
  let tipoEntrada = ""; let data = ""; let competencia = ""; let descricao = ""; let idempotencia = ""; let nomeOriginal = "";
  if (contentType.includes("multipart/form-data")) {
    const formulario = await request.formData().catch(() => null);
    const recebido = formulario?.get("arquivo") || formulario?.get("file");
    if (recebido instanceof File) arquivo = recebido;
    tipoEntrada = String(formulario?.get("tipo") || formulario?.get("type") || "");
    data = String(formulario?.get("data") || formulario?.get("date") || "");
    competencia = String(formulario?.get("competencia") || formulario?.get("competence") || "");
    descricao = String(formulario?.get("descricao") || formulario?.get("description") || "");
    idempotencia = String(formulario?.get("idempotency_key") || "");
    nomeOriginal = arquivo?.name || "";
  } else {
    const corpo = new Uint8Array(await request.arrayBuffer());
    arquivo = new File([corpo], decodificar(request.headers.get("x-file-name")) || "documento", { type:contentType });
    tipoEntrada = decodificar(request.headers.get("x-document-type"));
    data = request.headers.get("x-document-date") || "";
    competencia = request.headers.get("x-document-competence") || "";
    descricao = decodificar(request.headers.get("x-document-description"));
    idempotencia = request.headers.get("x-idempotency-key") || "";
    nomeOriginal = arquivo.name;
  }

  if (!arquivo) return json(request, { error:"O aplicativo não compartilhou um arquivo compatível." }, 400);
  const tipo = tipoCodigo(tipoEntrada);
  if (!tipo) return json(request, { error:"Escolha um tipo de documento válido no Atalho." }, 400);
  data = /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeSaoPaulo();
  competencia = /^\d{4}-\d{2}$/.test(competencia) ? competencia : data.slice(0, 7);
  descricao = descricao.trim().slice(0, 500);
  if (/\uFFFD|ï¿½/.test(descricao)) return json(request, {
    error:"A descrição chegou com um acento corrompido. No Atalho, passe a descrição pela ação ‘Codificar URL’ e use o resultado no cabeçalho x-document-description.",
  }, 400);
  let caminho = "";
  try {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const info = identificarArquivo(bytes);
    const sha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    const { data:arquivoJaCadastrado } = await db.from("documentos_contabeis")
      .select("id,arquivo_nome").eq("arquivo_sha256", sha256).limit(1).maybeSingle();
    if (arquivoJaCadastrado) return json(request, {
      ok:true, duplicate:true, documento_id:arquivoJaCadastrado.id,
      message:`Este arquivo já está cadastrado como ${arquivoJaCadastrado.arquivo_nome}.`,
    });
    // Algumas versões do Atalhos não oferecem a ação Gerar UUID. Quando a chave
    // não vier, a assinatura do próprio arquivo garante idempotência nos retries.
    const chaveIdempotencia = /^[A-Za-z0-9_-]{8,128}$/.test(idempotencia) ? idempotencia : sha256;
    const origemId = `${dispositivo.id}:${chaveIdempotencia}`;
    const { data:existente } = await db.from("documentos_contabeis").select("id,arquivo_nome").eq("origem_tipo", "atalho_ios").eq("origem_id", origemId).maybeSingle();
    if (existente) return json(request, { ok:true, duplicate:true, documento_id:existente.id, message:"Documento já recebido anteriormente." });
    const id = crypto.randomUUID();
    const descricaoNome = nomeExibicaoSeguro(descricao || NOMES_TIPOS[tipo] || "Documento");
    const dataNome = data.split("-").reverse().join("-");
    const nome = `${dataNome} - ${descricaoNome}.${info.extensao}`;
    const nomeStorage = `${nomeSeguro(`${data}-${descricaoNome}`)}.${info.extensao}`;
    caminho = `documentos/${competencia.replace("-", "/")}/${id}/${nomeStorage}`;
    const { error:erroUpload } = await db.storage.from(BUCKET).upload(caminho, bytes, { contentType:info.mime, cacheControl:"3600", upsert:false });
    if (erroUpload) throw new Error(`Não foi possível guardar o arquivo: ${erroUpload.message}`);
    const { data:registro, error:erroRegistro } = await db.from("documentos_contabeis").insert({
      id, tipo_codigo:tipo, data_documento:data, competencia:`${competencia}-01`, descricao:descricao || null,
      arquivo_path:caminho, arquivo_nome:nome, arquivo_mime:info.mime, arquivo_bytes:bytes.length,
      arquivo_sha256:sha256, status:"arquivado", origem_tipo:"atalho_ios", origem_id:origemId,
      criado_por:dispositivo.user_id, metadados:{ dispositivo_id:dispositivo.id, dispositivo_nome:dispositivo.nome, nome_original:nomeOriginal || null },
    }).select("id,arquivo_nome").single();
    if (erroRegistro) {
      if (erroRegistro.code === "23505") {
        await db.storage.from(BUCKET).remove([caminho]); caminho = "";
        const { data:repetido } = await db.from("documentos_contabeis").select("id,arquivo_nome").eq("origem_tipo", "atalho_ios").eq("origem_id", origemId).maybeSingle();
        return json(request, { ok:true, duplicate:true, documento_id:repetido?.id, message:"Documento já recebido anteriormente." });
      }
      throw new Error(erroRegistro.message);
    }
    return json(request, { ok:true, documento_id:registro.id, arquivo:registro.arquivo_nome, message:"Documento salvo na Tio Nan." });
  } catch (error) {
    if (caminho) await db.storage.from(BUCKET).remove([caminho]);
    return json(request, { error:error instanceof Error ? error.message : String(error) }, 400);
  }
});

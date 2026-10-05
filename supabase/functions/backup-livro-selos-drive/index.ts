import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_BACKUP_FOLDER_ID") || "";
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin || "https://www.tionan.com.br",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "Origin",
});
const json = (origin: string | null, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" } });

const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const pemToBytes = (pem: string) => {
  const normalized = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

async function googleServiceAccountToken(credentials: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "O Google recusou a autenticação do backup.");
  return String(data.access_token);
}

async function googleAccessToken() {
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN") || "";
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET") || "";
  if (refreshToken && clientId && clientSecret) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || "O Google recusou a renovação da autorização do Drive.");
    return String(data.access_token);
  }
  const rawCredentials = Deno.env.get("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON") || "";
  if (rawCredentials) {
    const credentials = JSON.parse(rawCredentials);
    if (!credentials.client_email || !credentials.private_key) throw new Error("As credenciais da conta de serviço do Google Drive estão incompletas.");
    return googleServiceAccountToken(credentials);
  }
  throw new Error("A autorização permanente do Google Drive ainda não foi configurada no servidor.");
}

async function uploadToDrive(accessToken: string, fileName: string, contents: string) {
  const boundary = `tio_nan_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = JSON.stringify({ name: fileName, parents: [DRIVE_FOLDER_ID], mimeType: "application/json" });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    contents,
    `\r\n--${boundary}--`,
  ]);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error(data?.error?.message || "Não foi possível gravar o arquivo no Google Drive.");
  return data as { id: string; name: string; webViewLink?: string; size?: string };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(origin, { error: "Use POST." }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const cronSecret = Deno.env.get("LIVRO_SELOS_BACKUP_SECRET") || "";
  const suppliedCronSecret = request.headers.get("x-backup-secret") || "";
  let userId: string | null = null;
  let originType: "automatico" | "manual" = "automatico";

  if (!cronSecret || suppliedCronSecret !== cronSecret) {
    const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: auth } = await db.auth.getUser(bearer);
    if (!auth.user) return json(origin, { error: "Sessão administrativa inválida." }, 401);
    const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", auth.user.id).maybeSingle();
    if (!admin) return json(origin, { error: "Acesso administrativo necessário." }, 403);
    userId = auth.user.id;
    originType = "manual";
  }

  if (payload.action === "confirmar") {
    if (originType !== "automatico") return json(origin, { error: "Confirmação automática inválida." }, 403);
    const backupId = String(payload.backup_id || "").trim();
    const fileId = String(payload.arquivo_id || "").trim();
    const fileName = String(payload.arquivo_nome || "").trim();
    const pdfFileId = String(payload.pdf_arquivo_id || "").trim();
    const pdfFileName = String(payload.pdf_arquivo_nome || "").trim();
    if (!backupId || !fileId || !fileName || !pdfFileId || !pdfFileName) return json(origin, { error: "Dados da confirmação incompletos." }, 400);
    const { error } = await db.from("livro_selos_backups").update({
      status: "concluido",
      arquivo_id: fileId,
      arquivo_nome: fileName,
      arquivo_url: String(payload.arquivo_url || `https://drive.google.com/file/d/${fileId}/view`),
      pdf_arquivo_id: pdfFileId,
      pdf_arquivo_nome: pdfFileName,
      pdf_arquivo_url: String(payload.pdf_arquivo_url || `https://drive.google.com/file/d/${pdfFileId}/view`),
      tamanho_bytes: Number(payload.tamanho_bytes || 0) || null,
      concluido_em: new Date().toISOString(),
      mensagem_erro: null,
    }).eq("id", backupId).eq("status", "processando");
    if (error) return json(origin, { error: error.message }, 500);
    return json(origin, { ok: true, backup_id: backupId });
  }

  const { data: backup, error: insertError } = await db.from("livro_selos_backups").insert({
    origem: originType, status: "processando", criado_por: userId,
  }).select("id").single();
  if (insertError || !backup) return json(origin, { error: insertError?.message || "Não foi possível iniciar o backup." }, 500);

  try {
    if (!DRIVE_FOLDER_ID) throw new Error("A pasta do Google Drive ainda não foi configurada no servidor.");
    const { data: insumos, error: suppliesError } = await db.from("insumos_envase")
      .select("id,codigo,nome,quantidade,atualizado_em").like("codigo", "selo_ipi_%").order("nome");
    if (suppliesError) throw suppliesError;

    const movimentos: unknown[] = [];
    const pageSize = 1000;
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await db.from("livro_selos_movimentos")
        .select("*,insumo:insumos_envase(id,codigo,nome,quantidade)")
        .order("data_movimento", { ascending: true }).order("criado_em", { ascending: true })
        .range(start, start + pageSize - 1);
      if (error) throw error;
      movimentos.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    const [{ data: lotes, error: lotsError }, { data: faixas, error: rangesError }] = await Promise.all([
      db.from("selos_lotes").select("*").order("data_entrada", { ascending: true }).order("criado_em", { ascending: true }),
      db.from("selos_faixas_utilizadas").select("*").order("criado_em", { ascending: true }),
    ]);
    if (lotsError) throw lotsError;
    if (rangesError) throw rangesError;

    const safeSupplies = insumos || [];
    const balances = Object.fromEntries(safeSupplies.map((supply) => [supply.codigo,
      movimentos.filter((row: any) => row.insumo_id === supply.id)
        .reduce((sum: number, row: any) => sum + Number(row.impacto_saldo_fiscal || 0), 0),
    ]));
    const document: Record<string, unknown> = {
      formato: "tio-nan-livro-selos-modelo-4", versao: 2, gerado_em: new Date().toISOString(),
      observacao: "Backup integral automático, sem filtros. Os saldos físicos refletem o momento da geração.",
      resumo: {
        tipos_de_selo: safeSupplies.length,
        total_de_lancamentos: movimentos.length,
        lotes_recebidos: (lotes || []).length,
        faixas_consumidas: (faixas || []).length,
      },
      saldos_fiscais_por_codigo: balances,
      insumos: safeSupplies,
      lotes: lotes || [],
      faixas: faixas || [],
      movimentos,
    };
    const contentsWithoutHash = JSON.stringify(document);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contentsWithoutHash));
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    document.integridade_sha256 = hash;
    const contents = JSON.stringify(document, null, 2);
    const now = new Date();
    const stamp = now.toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
    const fileName = `backup-livro-selos-modelo-4_${stamp}.json`;
    if (payload.destino === "apps-script") {
      await db.from("livro_selos_backups").update({
        arquivo_nome: fileName,
        total_lancamentos: movimentos.length,
        total_tipos_selo: safeSupplies.length,
        tamanho_bytes: new TextEncoder().encode(contents).length,
        integridade_sha256: hash,
      }).eq("id", backup.id);
      return json(origin, {
        ok: true,
        backup_id: backup.id,
        arquivo_nome: fileName,
        conteudo: contents,
        integridade_sha256: hash,
      });
    }
    const accessToken = await googleAccessToken();
    const driveFile = await uploadToDrive(accessToken, fileName, contents);
    await db.from("livro_selos_backups").update({
      status: "concluido", arquivo_id: driveFile.id, arquivo_nome: driveFile.name || fileName,
      arquivo_url: driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
      total_lancamentos: movimentos.length, total_tipos_selo: safeSupplies.length,
      tamanho_bytes: Number(driveFile.size || new TextEncoder().encode(contents).length),
      integridade_sha256: hash, concluido_em: new Date().toISOString(), mensagem_erro: null,
    }).eq("id", backup.id);
    return json(origin, { ok: true, backup_id: backup.id, arquivo_nome: driveFile.name || fileName, arquivo_url: driveFile.webViewLink });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao gerar o backup.";
    await db.from("livro_selos_backups").update({ status: "erro", mensagem_erro: message.slice(0, 1000), concluido_em: new Date().toISOString() }).eq("id", backup.id);
    return json(origin, { error: message, backup_id: backup.id }, 500);
  }
});

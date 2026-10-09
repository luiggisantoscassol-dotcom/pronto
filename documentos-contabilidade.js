(function () {
  const MIME_POR_TIPO = {
    pdf: 'application/pdf', xml: 'application/xml', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp'
  };

  const bytesIguais = (bytes, assinatura, inicio = 0) => assinatura.every((valor, indice) => bytes[inicio + indice] === valor);
  const nomeSeguro = (nome) => String(nome || 'documento')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 100) || 'documento';
  const criarId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let indice = 0; indice < bytes.length; indice += 1) bytes[indice] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  };

  class DocumentosContabeisService {
    constructor(db, opcoes = {}) {
      this.db = db;
      this.bucket = opcoes.bucket || 'notas-compra';
      this.maxBytes = opcoes.maxBytes || 15 * 1024 * 1024;
      this.enviando = false;
    }

    async identificarArquivo(arquivo) {
      if (!(arquivo instanceof File) || !arquivo.size) throw new Error('Escolha um arquivo válido.');
      if (arquivo.size > this.maxBytes) throw new Error('O arquivo deve ter no máximo 15 MB.');
      const extensao = String(arquivo.name || '').split('.').pop().toLowerCase();
      if (!MIME_POR_TIPO[extensao]) throw new Error('Use XML, PDF, JPG, JPEG, PNG ou WebP.');
      const bytes = new Uint8Array(await arquivo.slice(0, 1024).arrayBuffer());
      let mimeReal = '';
      if (bytesIguais(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) mimeReal = 'application/pdf';
      else if (bytesIguais(bytes, [0xff, 0xd8, 0xff])) mimeReal = 'image/jpeg';
      else if (bytesIguais(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mimeReal = 'image/png';
      else if (bytesIguais(bytes, [0x52, 0x49, 0x46, 0x46]) && bytesIguais(bytes, [0x57, 0x45, 0x42, 0x50], 8)) mimeReal = 'image/webp';
      else {
        const texto = new TextDecoder('utf-8', { fatal:false }).decode(bytes).replace(/^\uFEFF/, '').trimStart();
        if (/^<\?xml\b/i.test(texto) || /^<(nfeProc|NFe|CompNfse|ConsultarNfseResposta)\b/i.test(texto)) mimeReal = 'application/xml';
      }
      if (!mimeReal || mimeReal !== MIME_POR_TIPO[extensao]) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
      let sha256 = null;
      if (globalThis.crypto?.subtle) {
        const hash = await globalThis.crypto.subtle.digest('SHA-256', await arquivo.arrayBuffer());
        sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      }
      return {
        mime: mimeReal,
        extensao: extensao === 'jpeg' ? 'jpg' : extensao,
        sha256
      };
    }

    async salvar({ arquivo, tipo, data, competencia, descricao = '' }) {
      if (this.enviando) throw new Error('O documento já está sendo enviado.');
      if (!tipo || !data || !/^\d{4}-\d{2}$/.test(String(competencia || ''))) throw new Error('Preencha tipo, data e competência.');
      this.enviando = true;
      let caminho = '';
      try {
        const info = await this.identificarArquivo(arquivo);
        const id = criarId();
        const [ano, mes] = competencia.split('-');
        caminho = `documentos/${ano}/${mes}/${id}/${nomeSeguro(arquivo.name)}`;
        const { error: erroUpload } = await this.db.storage.from(this.bucket).upload(caminho, arquivo, {
          contentType: info.mime, cacheControl: '3600', upsert: false
        });
        if (erroUpload) throw new Error(`Não foi possível guardar o arquivo: ${erroUpload.message}`);
        const { data: { user } } = await this.db.auth.getUser();
        const { data: registro, error: erroRegistro } = await this.db.from('documentos_contabeis').insert({
          id, tipo_codigo: tipo, data_documento: data, competencia: `${competencia}-01`,
          descricao: String(descricao || '').trim() || null, arquivo_path: caminho,
          arquivo_nome: arquivo.name, arquivo_mime: info.mime, arquivo_bytes: arquivo.size,
          arquivo_sha256: info.sha256, status: 'arquivado', origem_tipo: 'upload_admin', criado_por:user?.id || null
        }).select('*').single();
        if (erroRegistro) throw new Error(erroRegistro.code === '23505' ? 'Este documento já foi cadastrado.' : erroRegistro.message);
        return registro;
      } catch (erro) {
        if (caminho) await this.db.storage.from(this.bucket).remove([caminho]).catch(() => {});
        throw erro;
      } finally {
        this.enviando = false;
      }
    }

    async urlTemporaria(caminho, nome = '') {
      const opcoes = nome ? { download:nome } : undefined;
      const { data, error } = await this.db.storage.from(this.bucket).createSignedUrl(caminho, 60, opcoes);
      if (error || !data?.signedUrl) throw new Error(error?.message || 'Não foi possível gerar o acesso temporário.');
      return data.signedUrl;
    }
  }

  window.DocumentosContabeisService = DocumentosContabeisService;
})();

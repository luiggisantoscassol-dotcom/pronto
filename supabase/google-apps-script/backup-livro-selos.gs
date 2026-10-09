const BACKUP_FOLDER_ID = '1TYgeD-IK-gOdZnhKf1S03Q3e3i3FLSnY';
const BACKUP_FUNCTION_URL = 'https://eegqobqhrfdkmjyjnqvp.supabase.co/functions/v1/backup-livro-selos-drive';

function executarBackupLivroSelos() {
  const secret = PropertiesService.getScriptProperties().getProperty('BACKUP_SECRET');
  if (!secret) throw new Error('BACKUP_SECRET não configurado nas propriedades do script.');

  const prepared = chamarServidor_({ action: 'preparar', destino: 'apps-script' }, secret);
  if (!prepared.ok || !prepared.backup_id || !prepared.arquivo_nome || !prepared.conteudo) {
    throw new Error(prepared.error || 'O servidor não entregou o backup completo.');
  }

  const folder = DriveApp.getFolderById(BACKUP_FOLDER_ID);
  const jsonBlob = Utilities.newBlob(prepared.conteudo, 'application/json', prepared.arquivo_nome);
  const pdfName = prepared.arquivo_nome.replace(/\.json$/i, '.pdf');
  const pdfBlob = gerarPdfLivroSelos_(prepared.conteudo, pdfName);
  const jsonFile = folder.createFile(jsonBlob);
  const pdfFile = folder.createFile(pdfBlob);

  const confirmed = chamarServidor_({
    action: 'confirmar',
    backup_id: prepared.backup_id,
    arquivo_id: jsonFile.getId(),
    arquivo_nome: jsonFile.getName(),
    arquivo_url: jsonFile.getUrl(),
    pdf_arquivo_id: pdfFile.getId(),
    pdf_arquivo_nome: pdfFile.getName(),
    pdf_arquivo_url: pdfFile.getUrl(),
    tamanho_bytes: jsonBlob.getBytes().length + pdfBlob.getBytes().length,
  }, secret);
  if (!confirmed.ok) throw new Error(confirmed.error || 'O arquivo foi salvo, mas a confirmação falhou.');
  console.log(`Backup concluído: ${jsonFile.getName()} e ${pdfFile.getName()} (${pdfFile.getUrl()})`);
}

function gerarPdfLivroSelos_(conteudoJson, nomeArquivo) {
  const dados = JSON.parse(conteudoJson);
  const insumos = Array.isArray(dados.insumos) ? dados.insumos : [];
  const movimentos = Array.isArray(dados.movimentos) ? dados.movimentos : [];
  const saldos = dados.saldos_fiscais_por_codigo || {};
  const geradoEm = formatarDataHora_(dados.gerado_em);
  const linhasSaldo = insumos.length ? insumos.map((item) => {
    const saldoFiscal = Number(saldos[item.codigo] || 0);
    return `<tr><td>${escaparHtml_(item.nome || item.codigo)}</td><td>${escaparHtml_(item.codigo || '')}</td><td class="num">${formatarNumero_(item.quantidade)}</td><td class="num">${formatarNumero_(saldoFiscal)}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="vazio">Nenhum tipo de selo cadastrado.</td></tr>';

  const linhasMovimentos = movimentos.length ? movimentos.map((item) => {
    const insumo = item.insumo || {};
    const faixa = item.numeracao_inicial || item.numeracao_final
      ? `${item.numeracao_inicial || '-'} a ${item.numeracao_final || '-'}`
      : '-';
    const documento = item.nfe_numero
      ? `NF-e ${item.nfe_numero}${item.nfe_serie ? ` / série ${item.nfe_serie}` : ''}`
      : item.guia_numero ? `Guia ${item.guia_numero}` : '-';
    return `<tr>
      <td>${escaparHtml_(formatarData_(item.data_movimento))}</td>
      <td>${escaparHtml_(insumo.nome || insumo.codigo || '')}</td>
      <td>${escaparHtml_(rotuloTipo_(item.tipo))}</td>
      <td class="num">${formatarNumero_(item.quantidade)}</td>
      <td class="num ${Number(item.impacto_saldo_fiscal || 0) < 0 ? 'negativo' : ''}">${formatarNumeroComSinal_(item.impacto_saldo_fiscal)}</td>
      <td>${escaparHtml_(faixa)}</td>
      <td>${escaparHtml_(documento)}</td>
      <td>${escaparHtml_(item.observacoes || '-')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="vazio">Nenhum lançamento registrado.</td></tr>';

  const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
    @page { size: A4 landscape; margin: 14mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #18385f; font-family: Arial, sans-serif; font-size: 9px; }
    .cabecalho { border-bottom: 3px solid #c99b3f; padding: 0 0 12px; margin-bottom: 14px; }
    .marca { color: #c08b2d; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
    h1 { margin: 5px 0 2px; font-family: Georgia, serif; font-size: 21px; color: #102f57; }
    .subtitulo { color: #66768c; font-size: 9px; }
    .resumo { display: table; width: 100%; table-layout: fixed; margin: 0 0 15px; border-spacing: 7px 0; }
    .resumo > div { display: table-cell; padding: 10px 12px; background: #f7f3ea; border: 1px solid #e2d8c5; border-radius: 8px; }
    .resumo span { display: block; color: #7b8798; font-size: 8px; font-weight: 700; text-transform: uppercase; }
    .resumo strong { display: block; margin-top: 4px; font-size: 15px; color: #102f57; }
    h2 { margin: 16px 0 7px; color: #102f57; font-family: Georgia, serif; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th { padding: 7px 6px; background: #102f57; color: #fff; border: 1px solid #102f57; font-size: 7.5px; text-align: left; text-transform: uppercase; }
    td { padding: 6px; border: 1px solid #dce2e8; color: #324b69; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    .num { text-align: right; font-weight: 700; white-space: nowrap; }
    .negativo { color: #a42f2f; }
    .vazio { text-align: center; padding: 16px; color: #7b8798; }
    .hash { margin-top: 14px; padding: 8px 10px; background: #f7f3ea; border-left: 3px solid #c99b3f; color: #5d6d82; font-size: 7px; overflow-wrap: anywhere; }
    .rodape { margin-top: 8px; color: #7b8798; font-size: 7px; text-align: right; }
    .movimentos th:nth-child(1) { width: 7%; } .movimentos th:nth-child(2) { width: 14%; }
    .movimentos th:nth-child(3) { width: 11%; } .movimentos th:nth-child(4) { width: 7%; }
    .movimentos th:nth-child(5) { width: 8%; } .movimentos th:nth-child(6) { width: 12%; }
    .movimentos th:nth-child(7) { width: 13%; } .movimentos th:nth-child(8) { width: 28%; }
  </style></head><body>
    <div class="cabecalho"><div class="marca">Tio Nan</div><h1>Livro de Registro de Selo Especial de Controle - Modelo 4</h1><div class="subtitulo">Cópia de consulta gerada automaticamente em ${escaparHtml_(geradoEm)}</div></div>
    <div class="resumo"><div><span>Tipos de selo</span><strong>${formatarNumero_(dados.resumo && dados.resumo.tipos_de_selo)}</strong></div><div><span>Total de lançamentos</span><strong>${formatarNumero_(dados.resumo && dados.resumo.total_de_lancamentos)}</strong></div><div><span>Formato do backup</span><strong>Versão ${formatarNumero_(dados.versao || 1)}</strong></div></div>
    <h2>Saldos por tipo de selo</h2>
    <table><thead><tr><th>Selo</th><th>Código</th><th>Saldo físico</th><th>Saldo fiscal</th></tr></thead><tbody>${linhasSaldo}</tbody></table>
    <h2>Movimentações cronológicas</h2>
    <table class="movimentos"><thead><tr><th>Data</th><th>Selo</th><th>Movimento</th><th>Qtd.</th><th>Impacto</th><th>Numeração</th><th>Documento</th><th>Observações</th></tr></thead><tbody>${linhasMovimentos}</tbody></table>
    <div class="hash"><strong>Integridade SHA-256:</strong> ${escaparHtml_(dados.integridade_sha256 || 'não informada')}</div>
    <div class="rodape">Documento de consulta. O arquivo JSON de mesmo nome é a cópia técnica destinada à restauração integral.</div>
  </body></html>`;
  return Utilities.newBlob(html, 'text/html', nomeArquivo.replace(/\.pdf$/i, '.html'))
    .getAs(MimeType.PDF)
    .setName(nomeArquivo);
}

function escaparHtml_(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function formatarNumero_(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function formatarNumeroComSinal_(valor) {
  const numero = Number(valor || 0);
  return `${numero > 0 ? '+' : ''}${numero.toLocaleString('pt-BR')}`;
}

function formatarData_(valor) {
  if (!valor) return '-';
  const partes = String(valor).slice(0, 10).split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : String(valor);
}

function formatarDataHora_(valor) {
  if (!valor) return '-';
  return Utilities.formatDate(new Date(valor), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
}

function rotuloTipo_(tipo) {
  const rotulos = {
    saldo_inicial: 'Saldo inicial', entrada: 'Entrada', aplicacao_envase: 'Aplicação no envase',
    inutilizacao: 'Inutilização', devolucao: 'Devolução', saida_fiscal: 'Saída fiscal',
    estorno_saida_fiscal: 'Estorno fiscal', ajuste_positivo: 'Ajuste positivo',
    ajuste_negativo: 'Ajuste negativo', estorno_envase: 'Estorno de envase'
  };
  return rotulos[tipo] || String(tipo || '').replace(/_/g, ' ');
}

function instalarAgendamentoDiario() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'executarBackupLivroSelos')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('executarBackupLivroSelos')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  executarBackupLivroSelos();
}

function chamarServidor_(body, secret) {
  const response = UrlFetchApp.fetch(BACKUP_FUNCTION_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-backup-secret': secret },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || '{}');
  if (status < 200 || status >= 300) throw new Error(data.error || `Falha HTTP ${status}.`);
  return data;
}

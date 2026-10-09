# Atalho “Enviar para Tio Nan” — iPhone

O iOS não oferece Web Share Target para PWAs. A integração usa um Atalho exibido na folha Compartilhar do iPhone e uma credencial exclusiva, limitada a cadastrar documentos.

## Configuração única

1. No painel Tio Nan, abra **Notas / Contabilidade**.
2. Em **Compartilhar pelo iPhone**, toque em **Gerar acesso do iPhone**.
3. Copie o token exibido. Ele aparece somente uma vez.
4. No app **Atalhos**, crie o atalho **Enviar para Tio Nan**.
5. Nos detalhes, ative **Mostrar na Folha de Compartilhamento** e aceite **Arquivos**, **Imagens** e **PDFs**.
6. Adicione uma ação **Lista** com: Nota Fiscal (NF-e), XML de NF-e, DANFE, NFS-e, Comprovante bancário, Comprovante PIX, Boleto, Recibo e Outro.
7. Adicione **Escolher da Lista**.
8. Adicione **Pedir Entrada**, selecione **Texto** e use a pergunta `Descrição do documento`.
9. Adicione **Obter Detalhes de Arquivos**, detalhe **Nome**, usando a Entrada do Atalho.
10. Adicione **Obter Conteúdo de URL**, usando a URL mostrada pelo painel e método `POST`.
11. Adicione os cabeçalhos:
    - `x-tio-nan-token`: token copiado;
    - `x-document-type`: Item escolhido;
    - `x-document-description`: Entrada fornecida;
    - `x-file-name`: Nome obtido do arquivo.
12. Em **Corpo da Requisição**, escolha **Arquivo** e selecione **Entrada do Atalho**. Não utilize Formulário.
13. Obtenha o valor `message` da resposta e finalize com **Mostrar Resultado**.

A data atual e a competência são preenchidas automaticamente pelo servidor no fuso horário de São Paulo. A descrição fica vazia nesse fluxo rápido e pode continuar sendo informada no upload tradicional.

Se o aplicativo de origem compartilhar apenas texto ou uma URL, e não o arquivo, o Atalho informará que o conteúdo é incompatível. Nesse caso, use o upload tradicional da Etapa 1.

## Segurança

- O token só permite upload; não lê documentos nem outras áreas administrativas.
- O banco guarda apenas o SHA-256 do token.
- O acesso pode ser revogado no painel.
- O endpoint valida o conteúdo real e mantém o Storage privado.
- A assinatura SHA-256 do arquivo impede duplicidade em retries, sem exigir uma ação UUID no iPhone.

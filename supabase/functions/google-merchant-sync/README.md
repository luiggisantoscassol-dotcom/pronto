# Sincronização com Google Merchant Center

Edge Function que envia os produtos públicos da tabela `produtos` para a fonte
primária de API do Merchant Center, atualiza preço e disponibilidade e remove da
fonte os produtos que forem ocultados.

## Secrets necessários

- `GOOGLE_MERCHANT_ACCOUNT_ID` (opcional; padrão: `5873995150`)
- `GOOGLE_MERCHANT_DATASOURCE_ID` (opcional; a função procura a fonte `pt/BR`)
- `GOOGLE_MERCHANT_OAUTH_JSON` (JSON com `client_id`, `client_secret` e
  `refresh_token`; método recomendado quando chaves de conta de serviço estão
  bloqueadas pela política do Google Cloud)
- `GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON` (alternativa legada; JSON completo da
  conta de serviço)
- `MERCHANT_SYNC_SECRET` (segredo para chamadas agendadas/manuais)

A conta Google autorizada (ou a conta de serviço, no método alternativo) precisa
ter acesso ao Merchant Center, e a Merchant API precisa estar ativada no projeto
do Google Cloud.

## Execução

Faça um `POST` para `/functions/v1/google-merchant-sync`, usando o cabeçalho
`x-sync-secret`. A função também aceita a chave `service_role` como bearer token.

O agendamento recomendado é diário. A Merchant API exige atualização ao menos a
cada 30 dias; a rotina diária mantém estoque e preço atualizados.

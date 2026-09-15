# NF-e do Bling no painel administrativo

O fluxo usa OAuth 2.0 já conectado ao Bling, mas os tokens e os IDs das
naturezas ficam somente nas Edge Functions. O navegador envia apenas a chave
funcional de uma das cinco opções autorizadas.

## Configuração obrigatória no Supabase

Cadastre os seguintes secrets com os IDs das naturezas **já existentes no
Bling**:

- `BLING_NATURE_CONSUMIDOR_FINAL_ID`
- `BLING_NATURE_REVENDA_RS_NORMAL_ID`
- `BLING_NATURE_REVENDA_RS_SIMPLES_ID`
- `BLING_NATURE_REVENDA_FORA_RS_NORMAL_ID`
- `BLING_NATURE_REVENDA_FORA_RS_SIMPLES_ID`

Configure também `BLING_NFE_ENVIRONMENT` com exatamente `homologacao` ou
`producao`. Enquanto esse valor estiver ausente, a Edge Function recusa toda
emissão. O painel não permite escolher o ambiente.

Exemplo de configuração (substitua os quatro IDs):

```sh
supabase secrets set \
  BLING_NFE_ENVIRONMENT=homologacao \
  BLING_NATURE_CONSUMIDOR_FINAL_ID=ID_NO_BLING \
  BLING_NATURE_REVENDA_RS_NORMAL_ID=ID_NO_BLING \
  BLING_NATURE_REVENDA_RS_SIMPLES_ID=ID_NO_BLING \
  BLING_NATURE_REVENDA_FORA_RS_NORMAL_ID=ID_NO_BLING \
  BLING_NATURE_REVENDA_FORA_RS_SIMPLES_ID=ID_NO_BLING
```

## Importante sobre testes

A homologação de um **aplicativo da API** valida o aplicativo OAuth e seus
endpoints; ela não transforma uma NF-e real em nota de teste. O ambiente fiscal
da NF-e deve estar configurado na própria conta/emissor do Bling. Portanto,
antes de definir `BLING_NFE_ENVIRONMENT=homologacao`, confirme no Bling que o
emissor fiscal também está em homologação.

## Fluxo no admin

1. Abra um pedido já sincronizado com o Bling.
2. Clique em **Emitir / consultar nota fiscal**.
3. Revise comprador, CPF, destino, itens, pagamento e total.
4. Informe se o comprador é consumidor final ou revendedor.
5. Para consumidor final, o painel usa uma única natureza e o Bling aplica a
   regra pelo endereço. Para revenda, a sugestão combina UF e regime tributário.
   A seleção manual permanece limitada às cinco naturezas autorizadas.
6. Confirme a emissão. O ambiente é exibido novamente no alerta final.
7. Use **Atualizar situação** e, depois da autorização, baixe DANFE ou XML.

Se o escopo OAuth de notas fiscais não estiver habilitado, o painel preserva o
pedido e mostra o erro retornado pelo Bling; ele não tenta emitir novamente de
forma silenciosa.

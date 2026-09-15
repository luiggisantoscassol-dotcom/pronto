  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

  const API_BASE = "https://api.bling.com.br/Api/v3";
  const CONSUMER_FINAL_NATURE_ID = 15111377049;
  const BLING_PAYMENT_METHOD_IDS: Record<string, number> = {
    pix: 11024643,
    visa: 11024694,
    master: 11024672,
    mastercard: 11024672,
    elo: 11024695,
    amex: 11024703,
    american_express: 11024703,
    dinheiro: 10734866,
    // Pedidos de teste são exclusivos do administrador. No Bling usamos a
    // forma financeira de dinheiro, mantendo a identificação de teste nas observações.
    teste: 10734866,
  };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  const cleanPhone = (value?: string | null) => (value || "").replace(/\D/g, "");
  const cleanCpf = (value?: string | null) => (value || "").replace(/\D/g, "").slice(0, 11);
  const isValidEmail = (value?: string | null) => Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const normalizeText = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  Deno.serve(async (request) => {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret || request.headers.get("x-bling-sync-secret") !== syncSecret) {
      return json({ error: "Não autorizado." }, 401);
    }
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    const input = await request.json().catch(() => ({}));
    const action = input.action;
    if (!["produtos", "criar_produto", "atualizar_produto", "clientes", "atualizar_cliente", "pedido", "depositos", "entrada_estoque", "saida_estoque", "zerar_estoque_deposito", "reconciliar_pedidos"].includes(action)) return json({ error: "Ação inválida." }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: connection, error } = await db
      .from("bling_integracao")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "principal")
      .single();
    if (error || !connection?.access_token) return json({ error: "Bling ainda não está conectado." }, 400);

    let accessToken = connection.access_token;
    if (connection.expires_at && new Date(connection.expires_at) <= new Date(Date.now() + 60_000)) {
      const credentials = btoa(`${Deno.env.get("BLING_CLIENT_ID")}:${Deno.env.get("BLING_CLIENT_SECRET")}`);
      const refresh = await fetch(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: { authorization: `Basic ${credentials}`, "content-type": "application/x-www-form-urlencoded", "enable-jwt": "1" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refresh_token }),
      });
      const token = await refresh.json();
      if (!refresh.ok) return json({
        error: "A autorização do Bling expirou. Abra o menu do admin, clique em ‘Reconectar Bling’ e autorize novamente.",
        codigo: "BLING_RECONNECT_REQUIRED",
      }, 401);
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
        const detail = data?.error?.fields?.map?.((field: Record<string, unknown>) => `${field.element || "campo"}: ${field.msg || field.message || "inválido"}`).join("; ")
          || data?.error?.description
          || data?.message
          || `Erro Bling (${response.status})`;
        throw new Error(detail);
      }
      return data;
    };

    try {
      if (action === "atualizar_cliente") {
        const clienteId = String(input.cliente_id || "");
        if (!clienteId) return json({ error: "Cliente não informado." }, 400);
        const { data: cliente, error: clienteError } = await db.from("clientes")
          .select("id,nome,email,telefone,cpf,rua,numero,complemento,bairro,cep,cidade,estado,bling_id")
          .eq("id", clienteId).single();
        if (clienteError || !cliente) return json({ error: "Cliente não encontrado." }, 404);
        if (!cliente.bling_id) return json({ error: "Este cliente ainda não possui vínculo com o Bling." }, 409);
        const telefone = cleanPhone(cliente.telefone);
        const cpf = cleanCpf(cliente.cpf);
        const payload: Record<string, unknown> = {
          nome: String(cliente.nome || "").trim(),
          tipo: "F",
          situacao: "A",
        };
        if (telefone.length === 10 || telefone.length === 11) payload.celular = telefone;
        if (cpf.length === 11) payload.numeroDocumento = cpf;
        if (isValidEmail(cliente.email)) {
          payload.email = String(cliente.email).trim().toLowerCase();
          payload.emailNotaFiscal = String(cliente.email).trim().toLowerCase();
        }
        if (cliente.rua && cliente.numero && cliente.bairro && cliente.cep && cliente.cidade && cliente.estado) {
          payload.endereco = { geral: {
            endereco: String(cliente.rua).trim(),
            numero: String(cliente.numero).trim(),
            complemento: String(cliente.complemento || "").trim(),
            bairro: String(cliente.bairro).trim(),
            cep: String(cliente.cep).replace(/\D/g, "").slice(0, 8),
            municipio: String(cliente.cidade).trim(),
            uf: String(cliente.estado).trim().toUpperCase().slice(0, 2),
          } };
        }
        await bling(`/contatos/${encodeURIComponent(String(cliente.bling_id))}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        await db.from("clientes").update({ bling_sincronizado_em: new Date().toISOString() }).eq("id", clienteId);
        return json({ ok: true, action, contato_id: String(cliente.bling_id) });
      }

      if (action === "atualizar_produto") {
        const produto = input.produto && typeof input.produto === "object" ? input.produto : {};
        const produtoId = String(produto.id || "");
        const nome = String(produto.nome || "").trim();
        const preco = Number(produto.preco);
        const precoOriginal = Number(produto.preco_original || 0);
        const custo = Number(produto.custo || 0);
        if (!produtoId || nome.length < 3 || !Number.isFinite(preco) || preco <= 0 || !Number.isFinite(custo) || custo < 0) {
          return json({ error: "Informe produto, nome, preço de venda e custo válidos." }, 400);
        }
        const { data: local, error: localError } = await db.from("produtos").select("id,bling_id").eq("id", produtoId).single();
        if (localError || !local?.bling_id) return json({ error: "Produto local ou vínculo com o Bling não encontrado." }, 404);
        // PATCH altera apenas os campos administrados pela loja. O PUT exige a
        // representação completa do produto e pode rejeitar a edição de nome
        // quando campos fiscais mantidos exclusivamente no Bling são omitidos.
        await bling(`/produtos/${encodeURIComponent(String(local.bling_id))}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nome,
            preco,
            precoCusto: custo,
            descricaoCurta: String(produto.descricao || "").trim().slice(0, 255),
          }),
        });
        const { data: salvo, error: salvarError } = await db.from("produtos").update({
          nome,
          preco,
          preco_original: precoOriginal > preco ? precoOriginal : null,
          custo,
          foto_1: String(produto.foto_1 || "").trim() || null,
          foto_2: String(produto.foto_2 || "").trim() || null,
          descricao: String(produto.descricao || "").trim() || null,
          teor_alcoolico: String(produto.teor_alcoolico || "").trim() || null,
          harmonizacao: String(produto.harmonizacao || "").trim() || null,
          excluido: false,
          bling_sincronizado_em: new Date().toISOString(),
        }).eq("id", produtoId).select("id,bling_id,nome,preco,preco_original,custo,foto_1,foto_2").single();
        if (salvarError) throw salvarError;
        return json({ ok: true, action, produto: salvo });
      }

      if (action === "criar_produto") {
        const produto = input.produto && typeof input.produto === "object" ? input.produto : {};
        const nome = String(produto.nome || "").trim();
        const preco = Number(produto.preco);
        const precoOriginal = Number(produto.preco_original || 0);
        const custo = Number(produto.custo || 0);
        const blingIdInformado = String(produto.bling_id || "").trim();
        const tipoProduto = produto.tipo_produto === "kit" ? "kit" : "unitario";
        const componentesInformados = Array.isArray(produto.componentes) ? produto.componentes : [];
        if (nome.length < 3 || !Number.isFinite(preco) || preco <= 0 || !Number.isFinite(custo) || custo < 0) {
          return json({ error: "Informe nome, preço de venda e custo válidos." }, 400);
        }
        if (blingIdInformado && !/^\d+$/.test(blingIdInformado)) {
          return json({ error: "O ID informado do Bling é inválido." }, 400);
        }
        const componentes = componentesInformados
          .map((item: Record<string, unknown>) => ({ bling_id: String(item.bling_id || ""), quantidade: Math.trunc(Number(item.quantidade || 0)) }))
          .filter((item: { bling_id: string; quantidade: number }) => item.quantidade > 0);
        const unidadesPorKit = componentes.reduce((total: number, item: { quantidade: number }) => total + item.quantidade, 0);
        if (tipoProduto === "kit" && (unidadesPorKit < 2 || componentes.some((item: { bling_id: string }) => !/^\d+$/.test(item.bling_id)))) {
          return json({ error: "Um kit precisa ter pelo menos duas garrafas e componentes válidos." }, 400);
        }
        const componentesBanco: Array<{ id: string; bling_id: string; nome: string }> = [];
        if (tipoProduto === "kit") {
          for (const componente of componentes) {
            const { data: base } = await db.from("produtos").select("id,bling_id,nome,tipo_produto").eq("bling_id", componente.bling_id).eq("excluido", false).maybeSingle();
            if (!base || base.tipo_produto === "kit") return json({ error: `Componente ${componente.bling_id} não é um produto-base válido.` }, 400);
            componentesBanco.push({ id: String(base.id), bling_id: String(base.bling_id), nome: String(base.nome) });
          }
        }

        let blingId = blingIdInformado;
        let nomeBling = nome;
        let precoBling = preco;
        if (blingId) {
          const existente = await bling(`/produtos/${encodeURIComponent(blingId)}`);
          if (!existente?.data?.id) return json({ error: "Produto não encontrado no Bling." }, 404);
          nomeBling = String(existente.data.nome || nome).trim();
          precoBling = Number(existente.data.preco ?? preco);
        } else {
          const criado = await bling("/produtos", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              nome,
              preco,
              precoCusto: custo,
              tipo: "P",
              situacao: "A",
              formato: "S",
              unidade: "UN",
              descricaoCurta: String(produto.descricao || "").trim().slice(0, 255),
            }),
          });
          blingId = String(criado?.data?.id || criado?.id || "");
          if (!blingId) throw new Error("O Bling criou o produto, mas não retornou seu ID.");
        }

        const payload = {
          bling_id: blingId,
          nome: blingIdInformado ? nomeBling : nome,
          preco: Number.isFinite(precoBling) ? precoBling : preco,
          preco_original: precoOriginal > preco ? precoOriginal : null,
          custo,
          estoque: 0,
          foto_1: String(produto.foto_1 || "").trim() || null,
          foto_2: String(produto.foto_2 || "").trim() || null,
          descricao: String(produto.descricao || "").trim() || null,
          teor_alcoolico: String(produto.teor_alcoolico || "").trim() || null,
          harmonizacao: String(produto.harmonizacao || "").trim() || null,
          tipo_produto: tipoProduto,
          unidades_por_kit: tipoProduto === "kit" ? unidadesPorKit : 1,
          visivel: true,
          excluido: false,
          bling_sincronizado_em: new Date().toISOString(),
        };
        const { data: salvo, error: salvarError } = await db.from("produtos").upsert(payload, { onConflict: "bling_id" }).select("id,bling_id,nome,preco,estoque,visivel").single();
        if (salvarError) throw salvarError;
        if (tipoProduto === "kit") {
          const { error: limparError } = await db.from("produto_componentes").delete().eq("kit_id", salvo.id);
          if (limparError) throw limparError;
          const linhas = componentes.map((item: { bling_id: string; quantidade: number }) => ({
            kit_id: salvo.id,
            componente_id: componentesBanco.find((base) => base.bling_id === item.bling_id)!.id,
            quantidade: item.quantidade,
          }));
          const { error: componentesError } = await db.from("produto_componentes").insert(linhas);
          if (componentesError) throw componentesError;
          await db.rpc("recalcular_estoque_kit", { p_kit: salvo.id });
        }
        return json({ ok: true, action, produto: { ...salvo, tipo_produto: tipoProduto, unidades_por_kit: tipoProduto === "kit" ? unidadesPorKit : 1 }, criado_no_bling: !blingIdInformado });
      }

      if (action === "reconciliar_pedidos") {
        const { data: locais, error: locaisError } = await db.from("pedidos").select("id,bling_id").not("bling_id", "is", null).is("bling_removido_em", null).limit(150);
        if (locaisError) throw locaisError;
        let verificados = 0, arquivados = 0;
        for (const pedido of (locais || [])) {
          const response = await fetch(`${API_BASE}/pedidos/vendas/${encodeURIComponent(String(pedido.bling_id))}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "enable-jwt": "1" } });
          if (response.status === 404 || response.status === 410) {
            await db.from("pedidos").update({ bling_removido_em: new Date().toISOString() }).eq("id", pedido.id);
            arquivados++;
          } else if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail?.error?.description || detail?.message || `Erro Bling (${response.status})`);
          }
          verificados++;
          await wait(350);
        }
        return json({ ok: true, verificados, arquivados });
      }

      if (action === "depositos") {
        try {
          const result = await bling("/depositos?pagina=1&limite=100");
          return json({ ok: true, depositos: (result.data || []).map((item: Record<string, unknown>) => ({ id: String(item.id), nome: item.descricao || item.nome || `Depósito ${item.id}` })) });
        } catch {
          // Algumas instalações não concedem o escopo de depósitos. Nesse caso,
          // o próprio saldo de estoque informa os depósitos acessíveis.
          const saldos = await bling("/estoques/saldos?idsProdutos[]=16687078597&idsProdutos[]=16699660347&idsProdutos[]=16699719562");
          const encontrados = new Map<string, string>();
          for (const produto of (saldos.data || [])) {
            for (const deposito of (produto.depositos || [])) {
              const id = String(deposito.id || deposito.deposito?.id || "");
              if (id) encontrados.set(id, String(deposito.descricao || deposito.nome || deposito.deposito?.descricao || `Depósito ${id}`));
            }
          }
          return json({ ok: true, depositos: [...encontrados].map(([id, nome]) => ({ id, nome })) });
        }
      }

      if (action === "zerar_estoque_deposito") {
        const depositoId = String(input.deposito_bling_id || "");
        const produtosGerenciados = ["16687078597", "16699660347", "16699719562"];
        if (!/^\d+$/.test(depositoId)) return json({ error: "Depósito inválido." }, 400);

        const resultado: Array<{ produto_bling_id: string; saldo_anterior: number; saldo_atual: number }> = [];
        for (const produtoId of produtosGerenciados) {
          const antes = await bling(`/estoques/saldos?idsProdutos[]=${encodeURIComponent(produtoId)}`);
          const linha = (antes.data || []).find((row: Record<string, unknown>) => String((row.produto as Record<string, unknown>)?.id || "") === produtoId);
          const deposito = (Array.isArray(linha?.depositos) ? linha.depositos : []).find((item: Record<string, unknown>) => String(item.id || (item.deposito as Record<string, unknown>)?.id || "") === depositoId);
          const saldoAnterior = Math.max(0, Math.trunc(Number(deposito?.saldoFisico ?? deposito?.saldo ?? deposito?.saldoVirtual ?? 0)));
          if (saldoAnterior > 0) {
            await bling("/estoques", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ deposito: { id: Number(depositoId) }, operacao: "S", produto: { id: Number(produtoId) }, quantidade: saldoAnterior, observacoes: "Zeragem autorizada do estoque de testes Tio Nan" }),
            });
            await wait(500);
          }
          const depois = await bling(`/estoques/saldos?idsProdutos[]=${encodeURIComponent(produtoId)}`);
          const linhaAtual = (depois.data || []).find((row: Record<string, unknown>) => String((row.produto as Record<string, unknown>)?.id || "") === produtoId);
          const saldoTotal = Number(linhaAtual?.saldoFisicoTotal ?? 0);
          const depositoAtual = (Array.isArray(linhaAtual?.depositos) ? linhaAtual.depositos : []).find((item: Record<string, unknown>) => String(item.id || (item.deposito as Record<string, unknown>)?.id || "") === depositoId);
          const saldoAtual = Math.max(0, Math.trunc(Number(depositoAtual?.saldoFisico ?? depositoAtual?.saldo ?? depositoAtual?.saldoVirtual ?? 0)));
          if (Number.isFinite(saldoTotal)) await db.from("produtos").update({ estoque: saldoTotal, bling_sincronizado_em: new Date().toISOString() }).eq("bling_id", produtoId);
          resultado.push({ produto_bling_id: produtoId, saldo_anterior: saldoAnterior, saldo_atual: saldoAtual });
          await wait(350);
        }
        return json({ ok: true, deposito_bling_id: depositoId, produtos: resultado });
      }

      if (action === "entrada_estoque" || action === "saida_estoque") {
        const produtoId = String(input.produto_bling_id || "");
        const depositoId = String(input.deposito_bling_id || "");
        const quantidade = Number(input.quantidade || 0);
        const envaseId = String(input.envase_id || "");
        const consignacaoId = String(input.consignacao_id || "");
        if (!["16687078597", "16699660347", "16699719562"].includes(produtoId) || !/^\d+$/.test(depositoId) || !Number.isInteger(quantidade) || quantidade <= 0) {
          return json({ error: "Produto, depósito ou quantidade inválidos." }, 400);
        }
        try {
          const operacao = action === "saida_estoque" ? "S" : "E";
          const result = await bling("/estoques", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deposito: { id: Number(depositoId) }, operacao, produto: { id: Number(produtoId) }, quantidade, observacoes: String(input.observacoes || (operacao === "E" ? "Entrada por envase Tio Nan" : "Estorno de envase Tio Nan")).slice(0, 255) }) });
          await wait(500);
          const saldoResult = await bling(`/estoques/saldos?idsProdutos[]=${encodeURIComponent(produtoId)}`);
          const saldoProduto = (saldoResult.data || []).find((row: Record<string, unknown>) => String((row.produto as Record<string, unknown>)?.id || "") === produtoId);
          const saldoFisico = Number(saldoProduto?.saldoFisicoTotal ?? 0);
          if (Number.isFinite(saldoFisico)) {
            await db.from("produtos").update({ estoque: saldoFisico, bling_sincronizado_em: new Date().toISOString() }).eq("bling_id", produtoId);
          }
          if (envaseId) await db.from("envases").update(operacao === "E" ? { bling_status: "sincronizado", bling_erro: null } : { estorno_bling_status: "sincronizado", estorno_bling_erro: null }).eq("id", envaseId);
          if (consignacaoId) await db.from("consignacao_movimentos").update({ bling_estoque_status: "sincronizado", bling_estoque_erro: null }).eq("id", consignacaoId);
          return json({ ok: true, data: result.data || result, saldo_fisico: saldoFisico });
        } catch (error) {
          if (envaseId) await db.from("envases").update(action === "entrada_estoque" ? { bling_status: "erro", bling_erro: error instanceof Error ? error.message : "Falha no Bling" } : { estorno_bling_status: "erro", estorno_bling_erro: error instanceof Error ? error.message : "Falha no Bling" }).eq("id", envaseId);
          if (consignacaoId) await db.from("consignacao_movimentos").update({ bling_estoque_status: "erro", bling_estoque_erro: error instanceof Error ? error.message : "Falha no Bling" }).eq("id", consignacaoId);
          throw error;
        }
      }

      if (action === "pedido") {
        const reference = String(input.referencia || "");
        if (!reference) return json({ error: "Informe a referência do pedido." }, 400);
        const { data: order, error: orderError } = await db.from("pedidos")
          .select("referencia,total,frete,endereco,itens_json,frete_detalhes,cliente_nome,cliente_telefone,cliente_email,cliente_cpf,status_pagamento,pagamento,pagamento_metodo,pagamento_parcelas,bling_id,bling_estoque_lancado_em")
          .eq("referencia", reference).single();
        if (orderError || !order) return json({ error: "Pedido não encontrado." }, 404);
        const isCashOrder = String(order.pagamento || "").toLowerCase().startsWith("dinheiro");
        const isTestOrder = order.status_pagamento === "pago_teste" || String(order.pagamento_metodo || "").toLowerCase() === "teste";
        if (order.status_pagamento !== "pago" && !isCashOrder && !isTestOrder) {
          return json({ error: "O pedido ainda não possui pagamento aprovado." }, 409);
        }
        const existingSaleId = order.bling_id ? String(order.bling_id) : null;

        const phone = cleanPhone(order.cliente_telefone);
        const orderCpf = cleanCpf(order.cliente_cpf);
        const clientFields = "id,nome,email,telefone,cpf,rua,numero,complemento,bairro,cep,cidade,estado,bling_id";
        let client = null;
        if (orderCpf.length === 11) {
          const result = await db.from("clientes").select(clientFields).eq("cpf", orderCpf).maybeSingle();
          client = result.data;
        }
        if (!client && phone) {
          const result = await db.from("clientes").select(clientFields).eq("telefone", phone).maybeSingle();
          client = result.data;
        }
        if (!client && isValidEmail(order.cliente_email)) {
          const result = await db.from("clientes").select(clientFields).ilike("email", order.cliente_email!.trim()).maybeSingle();
          client = result.data;
        }
        let contactId = client?.bling_id;
        const email = isValidEmail(order.cliente_email)
          ? order.cliente_email!.trim().toLowerCase()
          : isValidEmail(client?.email) ? client!.email!.trim().toLowerCase() : "";
        const cpf = orderCpf || cleanCpf(client?.cpf);
        const generalAddress = client?.rua && client?.numero && client?.bairro && client?.cep && client?.cidade && client?.estado ? {
          endereco: String(client.rua).trim(),
          numero: String(client.numero).trim(),
          complemento: String(client.complemento || "").trim(),
          bairro: String(client.bairro).trim(),
          cep: String(client.cep).replace(/\D/g, "").slice(0, 8),
          municipio: String(client.cidade).trim(),
          uf: String(client.estado).trim().toUpperCase().slice(0, 2),
        } : null;
        // Não confie cegamente em um vínculo antigo: confirme que o contato do
        // Bling realmente possui o CPF deste pedido antes de atualizá-lo.
        if (contactId && cpf.length === 11) {
          const linkedContact = await bling(`/contatos/${contactId}`);
          const linkedCpf = cleanCpf(String(linkedContact?.data?.numeroDocumento || ""));
          if (linkedCpf !== cpf) contactId = null;
          await wait(400);
        }
        if (!contactId && cpf.length === 11) {
          const foundContacts = await bling(`/contatos?pagina=1&limite=100&pesquisa=${encodeURIComponent(cpf)}`);
          const candidates = foundContacts?.data || [];
          let existingContact = candidates.find((contact: Record<string, unknown>) => cleanCpf(String(contact.numeroDocumento || "")) === cpf);
          for (const candidate of candidates.slice(0, 10)) {
            if (existingContact || !candidate?.id) break;
            const candidateDetails = await bling(`/contatos/${candidate.id}`);
            if (cleanCpf(String(candidateDetails?.data?.numeroDocumento || "")) === cpf) existingContact = candidateDetails.data;
            await wait(400);
          }
          if (existingContact?.id) {
            contactId = String(existingContact.id);
            if (client?.id) await db.from("clientes").update({ bling_id: contactId, bling_sincronizado_em: new Date().toISOString() }).eq("id", client.id);
          }
          await wait(400);
        }
        if (!contactId) {
          const contact: Record<string, unknown> = { nome: order.cliente_nome, tipo: "F", situacao: "A" };
          if (phone.length === 10 || phone.length === 11) contact.celular = phone;
          if (email) {
            contact.email = email;
            contact.emailNotaFiscal = email;
          }
          if (cpf.length === 11) contact.numeroDocumento = cpf;
          if (generalAddress) contact.endereco = { geral: generalAddress };
          try {
            const createdContact = await bling("/contatos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contact) });
            contactId = createdContact?.data?.id || createdContact?.id;
          } catch (createError) {
            const message = createError instanceof Error ? createError.message : "";
            if (!/CPF já está cadastrado/i.test(message) || cpf.length !== 11) throw createError;

            // Outro pedido do mesmo cliente pode ter criado o contato alguns
            // milissegundos antes. Consulte novamente e reutilize-o.
            await wait(500);
            const foundContacts = await bling(`/contatos?pagina=1&limite=100&pesquisa=${encodeURIComponent(cpf)}`);
            for (const candidate of (foundContacts?.data || []).slice(0, 10)) {
              if (!candidate?.id) continue;
              const candidateDetails = await bling(`/contatos/${candidate.id}`);
              if (cleanCpf(String(candidateDetails?.data?.numeroDocumento || "")) === cpf) {
                contactId = String(candidateDetails.data.id);
                break;
              }
              await wait(400);
            }
            if (!contactId) throw createError;
          }
          if (contactId && client?.id) await db.from("clientes").update({ bling_id: String(contactId), bling_sincronizado_em: new Date().toISOString() }).eq("id", client.id);
          await wait(400);
        }
        if (!contactId) throw new Error("Não foi possível identificar o contato no Bling.");

        const shippingDetails = order.frete_detalhes && typeof order.frete_detalhes === "object"
          ? order.frete_detalhes as Record<string, unknown>
          : {};
        const shippingOrigin = String(shippingDetails.origem || "").toLowerCase();
        const carrierName = String(shippingDetails.transportadora || "").trim();
        let carrierContactId = "";
        if (["frenet", "melhor_envio"].includes(shippingOrigin) && carrierName) {
          const aliases: Record<string, string> = {
            correios: "Empresa Brasileira de Correios e Telegrafos",
            jadlog: "Jadlog Logistica",
          };
          const searches = [...new Set([carrierName, aliases[normalizeText(carrierName)]].filter(Boolean))];
          const targetNames = searches.map(normalizeText);
          for (const search of searches) {
            const found = await bling(`/contatos?pagina=1&limite=100&pesquisa=${encodeURIComponent(search)}`);
            for (const candidate of (found?.data || []).slice(0, 15)) {
              if (!candidate?.id) continue;
              const details = await bling(`/contatos/${candidate.id}`);
              const candidateName = normalizeText(details?.data?.nome || candidate.nome);
              if (targetNames.some((target) => candidateName.includes(target) || target.includes(candidateName))) {
                carrierContactId = String(candidate.id);
                break;
              }
              await wait(350);
            }
            if (carrierContactId) break;
            await wait(350);
          }
          if (!carrierContactId) {
            throw new Error(`Cadastre a transportadora “${carrierName}” como contato no Bling, com CNPJ e endereço completos, e sincronize o pedido novamente.`);
          }
        }

        // O Bling exibe nos pedidos os dados atuais do contato vinculado. Como
        // opção escolhida para manter um único cadastro fiscal por CPF, atualiza
        // o contato principal com os dados mais recentes do checkout.
        const updatedContact: Record<string, unknown> = {
          nome: String(order.cliente_nome || "Cliente Tio Nan").trim(),
          tipo: "F",
          situacao: "A",
        };
        if (cpf.length === 11) updatedContact.numeroDocumento = cpf;
        if (phone.length === 10 || phone.length === 11) updatedContact.celular = phone;
        if (email) {
          updatedContact.email = email;
          updatedContact.emailNotaFiscal = email;
        }
        if (generalAddress) updatedContact.endereco = { geral: generalAddress };
        await bling(`/contatos/${contactId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(updatedContact),
        });
        await wait(400);

        const items = Array.isArray(order.itens_json) ? order.itens_json : [];
        if (!items.length) throw new Error("O pedido não possui itens estruturados.");
        // Reconstitui a composição pelo cadastro atual. Assim, pedidos antigos
        // ou criados durante a transição dos kits não dependem de uma cópia
        // desatualizada dos componentes dentro de itens_json.
        const itemIds = items.map((item: Record<string, unknown>) => String(item.id || "")).filter(Boolean);
        const { data: componentRows, error: componentError } = itemIds.length
          ? await db.from("produto_componentes")
            .select("kit_id,quantidade,componente:produtos!produto_componentes_componente_id_fkey(id,nome,bling_id,preco)")
            .in("kit_id", itemIds)
          : { data: [], error: null };
        if (componentError) throw new Error(`Não foi possível consultar a composição do kit: ${componentError.message}`);
        const currentComponents = new Map<string, Array<Record<string, unknown>>>();
        for (const row of componentRows || []) {
          const component = Array.isArray(row.componente) ? row.componente[0] : row.componente;
          if (!component?.bling_id || Number(row.quantidade || 0) <= 0) continue;
          const kitId = String(row.kit_id);
          const list = currentComponents.get(kitId) || [];
          list.push({
            id: component.id,
            nome: component.nome,
            bling_id: String(component.bling_id),
            preco_referencia: Number(component.preco || 0),
            quantidade: Number(row.quantidade),
          });
          currentComponents.set(kitId, list);
        }
        const today = new Date().toISOString().slice(0, 10);
        const providerMethod = String(order.pagamento_metodo || "").trim().toLowerCase();
        const paymentKey = isCashOrder ? "dinheiro" : providerMethod;
        const blingPaymentMethodId = BLING_PAYMENT_METHOD_IDS[paymentKey];
        if (!blingPaymentMethodId) throw new Error(`Forma de pagamento do Mercado Pago não mapeada: ${providerMethod || "não informada"}.`);
        const subtotalItens = items.reduce((total: number, item: Record<string, unknown>) => total + Number(item.preco || 0) * Number(item.quantidade || 1), 0);
        const totalMercadorias = Math.max(0, Number(order.total || 0) - Number(order.frete || 0));
        const fatorDescontoPedido = subtotalItens > 0 ? totalMercadorias / subtotalItens : 1;
        const blingItems = items.flatMap((item: Record<string, unknown>) => {
          const componentesAtuais = currentComponents.get(String(item.id || "")) || [];
          const componentesSalvos = Array.isArray(item.componentes) ? item.componentes as Array<Record<string, unknown>> : [];
          const componentes = componentesAtuais.length ? componentesAtuais : componentesSalvos;
          const precoKitComDesconto = Number(item.preco || 0) * fatorDescontoPedido;
          if (!componentes.length) return [{ ...item, preco: Number(precoKitComDesconto.toFixed(6)) }];
          const baseProporcional = componentes.reduce((sum, componente) => {
            const referencia = Number(componente.preco_referencia || 0);
            return sum + (referencia > 0 ? referencia : 1) * Number(componente.quantidade || 0);
          }, 0) || 1;
          return componentes.map((componente) => ({
            nome: `${String(componente.nome || "Componente")} — ${String(item.nome || "Kit")}`,
            bling_id: componente.bling_id,
            quantidade: Number(item.quantidade || 1) * Number(componente.quantidade || 0),
            preco: Number((precoKitComDesconto * (Number(componente.preco_referencia || 0) > 0 ? Number(componente.preco_referencia) : 1) / baseProporcional).toFixed(6)),
          }));
        });
        const salePayload = {
          data: today,
          numeroLoja: order.referencia,
          // O ID mantém o vínculo fiscal com o contato/CPF já cadastrado, mas os
          // demais campos registram os dados informados nesta venda específica.
          contato: {
            id: Number(contactId),
            nome: String(order.cliente_nome || "Cliente Tio Nan").trim(),
            tipoPessoa: "F",
            ...(cpf.length === 11 ? { numeroDocumento: cpf } : {}),
          },
          transporte: {
            fretePorConta: Number(order.frete || 0) > 0 ? 0 : 9,
            frete: Number(order.frete || 0),
            // Na API v3 do Bling, a transportadora vinculada ao pedido é
            // informada em `transporte.contato` (e não `transportador`).
            ...(carrierContactId ? { contato: { id: Number(carrierContactId) } } : {}),
            ...(generalAddress ? {
              etiqueta: {
                nome: String(order.cliente_nome || "Cliente Tio Nan").trim(),
                endereco: generalAddress.endereco,
                numero: generalAddress.numero,
                complemento: generalAddress.complemento,
                municipio: generalAddress.municipio,
                uf: generalAddress.uf,
                cep: generalAddress.cep,
                bairro: generalAddress.bairro,
                nomePais: "Brasil",
              },
            } : {}),
          },
          observacoes: `Pedido único do site ${order.referencia}. Cliente informado neste pedido: ${order.cliente_nome}; CPF: ${cpf}; telefone: ${phone}; e-mail: ${email}; entrega: ${order.endereco}`,
          parcelas: [{
            dataVencimento: today,
            valor: Number(order.total || 0),
            formaPagamento: { id: blingPaymentMethodId },
            observacoes: isTestOrder
              ? "Pagamento de teste administrativo — sem cobrança real."
              : isCashOrder
              ? "Pagamento em dinheiro na entrega ou retirada."
              : `Mercado Pago — ${providerMethod}; ${Math.max(1, Number(order.pagamento_parcelas || 1))} parcela(s).`,
          }],
          itens: blingItems.map((item: Record<string, unknown>) => ({
            ...(item.bling_id ? { produto: { id: Number(item.bling_id) } } : {}),
            naturezaOperacao: { id: CONSUMER_FINAL_NATURE_ID },
            descricao: String(item.nome || "Produto Tio Nan"),
            unidade: "UN",
            quantidade: Number(item.quantidade || 1),
            valor: Number(item.preco || 0),
          })),
        };
        try {
          const savedSale = await bling(
            existingSaleId ? `/pedidos/vendas/${encodeURIComponent(existingSaleId)}` : "/pedidos/vendas",
            { method: existingSaleId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(salePayload) },
          );
          const saleId = existingSaleId || savedSale?.data?.id || savedSale?.id;
          if (!saleId) throw new Error("Bling não retornou o ID do pedido.");
          await db.from("pedidos").update({ bling_id: String(saleId), bling_sincronizado_em: new Date().toISOString(), bling_erro: null }).eq("referencia", reference);
          // Atualizar uma venda existente corrige contato, endereço e
          // transportadora, mas nunca repete a baixa de estoque.
          if (existingSaleId) {
            return json({ ok: true, action, bling_id: String(saleId), existente: true, venda_atualizada: true, transportadora_atualizada: Boolean(carrierContactId) });
          }
          await wait(400);
          await bling(`/pedidos/vendas/${encodeURIComponent(String(saleId))}/lancar-estoque`, { method: "POST" });
          await db.from("pedidos").update({ bling_estoque_lancado_em: new Date().toISOString() }).eq("referencia", reference);
          for (const productId of [...new Set(blingItems.map((item: Record<string, unknown>) => String(item.bling_id || "")).filter(Boolean))]) {
            await wait(350);
            const stockResult = await bling(`/estoques/saldos?idsProdutos[]=${encodeURIComponent(productId)}`);
            const rows = Array.isArray(stockResult.data) ? stockResult.data : [];
            const stock = rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.saldoFisicoTotal ?? row.saldoFisico ?? 0), 0);
            if (Number.isFinite(stock)) await db.from("produtos").update({ estoque: stock, bling_sincronizado_em: new Date().toISOString() }).eq("bling_id", productId);
          }
          return json({ ok: true, action, bling_id: String(saleId), estoque_bling: true });
        } catch (saleError) {
          const message = saleError instanceof Error ? saleError.message : "Pedido recusado pelo Bling";
          await db.from("pedidos").update({ bling_erro: message }).eq("referencia", reference);
          throw saleError;
        }
      }

      if (action === "produtos") {
        const managedProductIds = new Set(["16687078597", "16699660347", "16699719562"]);
        const { data: localProducts, error: localProductsError } = await db
          .from("produtos")
          .select("id,bling_id,tipo_produto")
          .not("bling_id", "is", null)
          .eq("excluido", false);
        if (localProductsError) throw new Error(`Não foi possível ler o catálogo local: ${localProductsError.message}`);
        const localByBlingId = new Map(
          (localProducts || []).map((product: Record<string, unknown>) => [String(product.bling_id), product]),
        );
        if (!localByBlingId.size) throw new Error("Nenhum produto ativo está vinculado ao Bling.");
        let page = 1, total = 0;
        while (true) {
          const result = await bling(`/produtos?pagina=${page}&limite=100`);
          const items = result.data || [];
          for (const item of items) {
            const blingId = String(item.id);
            const localProduct = localByBlingId.get(blingId);
            // Sincronização é atualização, não importação do catálogo inteiro do
            // Bling. Produtos antigos ou de outras linhas não reaparecem na loja.
            if (!localProduct) continue;
            const payload: Record<string, unknown> = {
              bling_id: blingId,
              nome: item.nome,
              preco: Number(item.preco || 0),
              excluido: item.situacao === "I" || item.situacao === "inativo",
              bling_sincronizado_em: new Date().toISOString(),
            };
            try {
              if (managedProductIds.has(blingId)) {
                const stockResult = await bling(`/estoques/saldos?idsProdutos[]=${encodeURIComponent(blingId)}`);
                const stockRows = Array.isArray(stockResult.data) ? stockResult.data : [];
                const stock = stockRows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.saldoFisicoTotal ?? row.saldoFisico ?? row.saldoVirtualTotal ?? 0), 0);
                payload.estoque = Number.isFinite(stock) ? stock : 0;
                await wait(350);
              }
              const writeResult = await db.from("produtos").update(payload).eq("id", String(localProduct.id));
              if (writeResult.error) throw writeResult.error;
              total++;
            } catch (productError) {
              const message = productError instanceof Error ? productError.message : "falha desconhecida";
              throw new Error(`Produto ${item.nome || blingId} (Bling ${blingId}): ${message}`);
            }
          }
          if (items.length < 100) break;
          page++;
        }
        return json({ ok: true, action, total });
      }

      const { data: clients, error: clientsError } = await db.from("clientes").select("id,nome,email,telefone,rua,numero,bairro,cep,cidade,estado,bling_id").is("bling_id", null);
      if (clientsError) throw clientsError;
      let total = 0;
      const rejected: Array<{ id: string; nome: string; erro: string }> = [];
      for (const client of clients || []) {
        const phone = cleanPhone(client.telefone);
        if (!client.nome) continue;
        // O Bling exige `tipo` no cadastro de contato (não `tipoPessoa`).
        // Endereços incompletos são omitidos para não rejeitar o contato inteiro.
        const contact: Record<string, unknown> = {
          nome: client.nome.trim(),
          tipo: "F",
          situacao: "A",
        };
        if (phone.length === 10 || phone.length === 11) contact.celular = phone;
        if (isValidEmail(client.email)) contact.email = client.email!.trim();
        try {
          const created = await bling("/contatos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contact) });
          const blingId = created?.data?.id || created?.id;
          if (blingId) await db.from("clientes").update({ bling_id: String(blingId), bling_sincronizado_em: new Date().toISOString() }).eq("id", client.id);
          total++;
        } catch (error) {
          rejected.push({ id: String(client.id), nome: client.nome, erro: error instanceof Error ? error.message : "Cadastro recusado" });
        }
        // Limite oficial do Bling: no máximo 3 requisições por segundo.
        await wait(400);
      }
      return json({ ok: true, action, total, rejeitados: rejected });
    } catch (err) {
      console.error(err);
      if (action === "pedido" && input.referencia) {
        await db.from("pedidos").update({ bling_erro: err instanceof Error ? err.message : "Falha na sincronização." }).eq("referencia", String(input.referencia));
      }
      return json({ error: err instanceof Error ? err.message : "Falha na sincronização." }, 500);
    }
  });

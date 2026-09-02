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
  };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  const cleanPhone = (value?: string | null) => (value || "").replace(/\D/g, "");
  const cleanCpf = (value?: string | null) => (value || "").replace(/\D/g, "").slice(0, 11);
  const isValidEmail = (value?: string | null) => Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  Deno.serve(async (request) => {
    const syncSecret = Deno.env.get("BLING_SYNC_SECRET");
    if (!syncSecret || request.headers.get("x-bling-sync-secret") !== syncSecret) {
      return json({ error: "Não autorizado." }, 401);
    }
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    const input = await request.json().catch(() => ({}));
    const action = input.action;
    if (!["produtos", "clientes", "pedido"].includes(action)) return json({ error: "Informe action: produtos, clientes ou pedido." }, 400);

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
      if (!refresh.ok) return json({ error: "Não foi possível renovar a conexão com o Bling.", detail: token }, 401);
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
      if (action === "pedido") {
        const reference = String(input.referencia || "");
        if (!reference) return json({ error: "Informe a referência do pedido." }, 400);
        const { data: order, error: orderError } = await db.from("pedidos")
          .select("referencia,total,frete,endereco,itens_json,cliente_nome,cliente_telefone,cliente_email,cliente_cpf,status_pagamento,pagamento,pagamento_metodo,pagamento_parcelas,bling_id")
          .eq("referencia", reference).single();
        if (orderError || !order) return json({ error: "Pedido não encontrado." }, 404);
        const isCashOrder = String(order.pagamento || "").toLowerCase().startsWith("dinheiro");
        if (order.status_pagamento !== "pago" && !isCashOrder) {
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

        // Quando a venda já existe, sincroniza somente o contato. Não cria um
        // segundo pedido no Bling para a mesma referência.
        if (existingSaleId) {
          await db.from("pedidos").update({ bling_sincronizado_em: new Date().toISOString(), bling_erro: null }).eq("referencia", reference);
          return json({ ok: true, action, bling_id: existingSaleId, existente: true, contato_atualizado: true });
        }

        const items = Array.isArray(order.itens_json) ? order.itens_json : [];
        if (!items.length) throw new Error("O pedido não possui itens estruturados.");
        const today = new Date().toISOString().slice(0, 10);
        const providerMethod = String(order.pagamento_metodo || "").trim().toLowerCase();
        const paymentKey = isCashOrder ? "dinheiro" : providerMethod;
        const blingPaymentMethodId = BLING_PAYMENT_METHOD_IDS[paymentKey];
        if (!blingPaymentMethodId) throw new Error(`Forma de pagamento do Mercado Pago não mapeada: ${providerMethod || "não informada"}.`);
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
            observacoes: isCashOrder
              ? "Pagamento em dinheiro na entrega ou retirada."
              : `Mercado Pago — ${providerMethod}; ${Math.max(1, Number(order.pagamento_parcelas || 1))} parcela(s).`,
          }],
          itens: items.map((item: Record<string, unknown>) => ({
            ...(item.bling_id ? { produto: { id: Number(item.bling_id) } } : {}),
            naturezaOperacao: { id: CONSUMER_FINAL_NATURE_ID },
            descricao: String(item.nome || "Produto Tio Nan"),
            unidade: "UN",
            quantidade: Number(item.quantidade || 1),
            valor: Number(item.preco || 0),
          })),
        };
        try {
          const createdSale = await bling("/pedidos/vendas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(salePayload) });
          const saleId = createdSale?.data?.id || createdSale?.id;
          if (!saleId) throw new Error("Bling não retornou o ID do pedido.");
          await db.from("pedidos").update({ bling_id: String(saleId), bling_sincronizado_em: new Date().toISOString(), bling_erro: null }).eq("referencia", reference);
          return json({ ok: true, action, bling_id: String(saleId) });
        } catch (saleError) {
          const message = saleError instanceof Error ? saleError.message : "Pedido recusado pelo Bling";
          await db.from("pedidos").update({ bling_erro: message }).eq("referencia", reference);
          throw saleError;
        }
      }

      if (action === "produtos") {
        // Remove o vínculo informado anteriormente: o ID pertence a um combo,
        // não ao produto unitário Gengibre, Guaco e Mel.
        await db.from("produtos")
          .update({
            bling_id: null,
            bling_sincronizado_em: null,
            nome: "Gengibre, Guaco e Mel",
            preco: 50,
            excluido: false,
          })
          .eq("id", "3e878921-6b60-4cc6-b5d9-3faa25d9a9d9")
          .eq("bling_id", "16699719562");
        let page = 1, total = 0;
        while (true) {
          const result = await bling(`/produtos?pagina=${page}&limite=100`);
          const items = result.data || [];
          for (const item of items) {
            const payload: Record<string, unknown> = {
              bling_id: String(item.id),
              nome: item.nome,
              preco: Number(item.preco || 0),
              excluido: item.situacao === "I" || item.situacao === "inativo",
              bling_sincronizado_em: new Date().toISOString(),
            };
            const stock = item.estoque ?? item.saldoEstoque ?? item.estoques?.[0]?.saldoVirtual;
            if (Number.isFinite(Number(stock))) payload.estoque = Number(stock);
            const writeResult = await db.from("produtos").upsert(payload, { onConflict: "bling_id" });
            const upsertError = writeResult.error;
            if (upsertError) throw upsertError;
            total++;
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

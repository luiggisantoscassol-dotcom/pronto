import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try { const u = new URL(origin); return ["tionan.com.br","www.tionan.com.br","localhost","127.0.0.1","192.168.1.36","192.168.0.102"].includes(u.hostname) || u.hostname.endsWith(".vercel.app"); } catch { return false; }
};
const cors = (origin: string | null) => ({"access-control-allow-origin":origin && allowedOrigin(origin)?origin:"https://www.tionan.com.br","access-control-allow-headers":"authorization, apikey, content-type","access-control-allow-methods":"POST, OPTIONS",vary:"Origin"});
const json = (origin:string|null, body:unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8"}});

Deno.serve(async (request) => {
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS") return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST" || !allowedOrigin(origin)) return json(origin,{error:"Requisição não autorizada."},403);
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:auth}=await db.auth.getUser(token);
  if(!auth.user) return json(origin,{error:"Entre novamente no painel."},401);
  const {data:admin}=await db.from("admin_users").select("user_id").eq("user_id",auth.user.id).maybeSingle();
  if(!admin) return json(origin,{error:"Acesso administrativo necessário."},403);
  const input=await request.json().catch(()=>({}));
  const action=String(input.action||"listar");

  if(action==="listar") {
    const [envases, consignacoes, pedidos, backups, envios, historico]=await Promise.all([
      db.from("envases").select("id,produto_nome,lote,garrafas,produto_bling_id,deposito_bling_id,bling_status,bling_erro,criado_em").in("bling_status",["pendente","erro"]).is("estornado_em",null).order("criado_em",{ascending:false}).limit(100),
      db.from("consignacao_movimentos").select("id,tipo,data_movimento,deposito_bling_id,bling_estoque_status,bling_estoque_erro,bling_nfe_erro,criado_em,consignacao_empresas(nome,nome_fantasia)").or("bling_estoque_status.eq.erro,bling_nfe_erro.not.is.null").order("criado_em",{ascending:false}).limit(100),
      db.from("pedidos").select("id,referencia,cliente_nome,bling_id,bling_erro,bling_nfe_id,bling_nfe_erro,atualizado_em").or("bling_erro.not.is.null,bling_nfe_erro.not.is.null").order("atualizado_em",{ascending:false}).limit(100),
      db.from("livro_selos_backups").select("id,mensagem_erro,iniciado_em").eq("status","erro").order("iniciado_em",{ascending:false}).limit(30),
      db.from("documentos_contabeis_envios").select("id,competencia,erro,criado_em").eq("status","erro").order("criado_em",{ascending:false}).limit(30),
      db.from("bling_reprocessamentos").select("*").order("criado_em",{ascending:false}).limit(50),
    ]);
    const erro=[envases,consignacoes,pedidos,backups,envios,historico].find(x=>x.error)?.error;
    if(erro) return json(origin,{error:erro.message},500);
    return json(origin,{envases:envases.data||[],consignacoes:consignacoes.data||[],pedidos:pedidos.data||[],backups:backups.data||[],envios:envios.data||[],historico:historico.data||[]});
  }

  const tipo=String(input.tipo||""); const id=String(input.id||"");
  if(action!=="reprocessar" || !tipo || !id) return json(origin,{error:"Ação inválida."},400);
  const permitido=new Set(["envase","pedido","nfe_pedido","backup_selos"]);
  if(!permitido.has(tipo)) return json(origin,{error:"Este caso exige conferência manual para evitar movimentação duplicada."},409);
  const {data:log,error:logError}=await db.from("bling_reprocessamentos").insert({origem_tipo:tipo,origem_id:id,acao:"reprocessar",criado_por:auth.user.id}).select("id").single();
  if(logError) return json(origin,{error:logError.message},500);
  try {
    let endpoint=""; let payload:any={};
    if(tipo==="envase") {
      const {data:item,error}=await db.from("envases").select("id,produto_bling_id,deposito_bling_id,garrafas,lote,bling_status,estornado_em").eq("id",id).single();
      if(error||!item) throw new Error("Envase não encontrado.");
      if(item.estornado_em) throw new Error("Envase estornado não pode ser reenviado.");
      if(item.bling_status==="sincronizado") throw new Error("Este envase já está sincronizado.");
      endpoint="bling-sync"; payload={action:"entrada_estoque",produto_bling_id:item.produto_bling_id,deposito_bling_id:item.deposito_bling_id,quantidade:item.garrafas,envase_id:item.id,observacoes:`Reprocessamento do envase lote ${item.lote}`};
    } else if(tipo==="pedido") {
      const {data:item,error}=await db.from("pedidos").select("referencia").eq("id",id).single();
      if(error||!item) throw new Error("Pedido não encontrado.");
      endpoint="bling-sync"; payload={action:"pedido",referencia:item.referencia};
    } else if(tipo==="nfe_pedido") {
      endpoint="bling-nfe"; payload={action:"consultar",pedido_id:id};
    } else {
      endpoint="backup-livro-selos-drive"; payload={action:"backup",origem:"manual"};
    }
    const response=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${endpoint}`,{method:"POST",headers:{authorization:`Bearer ${token}`,apikey:Deno.env.get("SUPABASE_ANON_KEY")!,"content-type":"application/json",...(endpoint==="bling-sync"?{"x-bling-sync-secret":Deno.env.get("BLING_SYNC_SECRET")||""}:{})},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||`Falha no reprocessamento (${response.status}).`);
    await db.from("bling_reprocessamentos").update({status:"concluido",resposta:result,concluido_em:new Date().toISOString()}).eq("id",log.id);
    return json(origin,{ok:true,result});
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    await db.from("bling_reprocessamentos").update({status:"erro",erro:message,concluido_em:new Date().toISOString()}).eq("id",log.id);
    return json(origin,{error:message},422);
  }
});

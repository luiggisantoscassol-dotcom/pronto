import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try { const u=new URL(origin); return (u.protocol==="https:"&&(u.hostname==="tionan.com.br"||u.hostname==="www.tionan.com.br"||u.hostname.endsWith(".vercel.app")))||(u.protocol==="http:"&&(u.hostname==="localhost"||u.hostname==="127.0.0.1"||u.hostname==="192.168.1.36")); } catch { return false; }
};
const cors=(o:string|null)=>({"access-control-allow-origin":o&&allowedOrigin(o)?o:"https://www.tionan.com.br","access-control-allow-headers":"authorization, x-client-info, apikey, content-type","access-control-allow-methods":"POST, OPTIONS",vary:"Origin"});
const json=(o:string|null,b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors(o),"content-type":"application/json; charset=utf-8"}});
const digits=(v:unknown)=>String(v||"").replace(/\D/g,"");

Deno.serve(async(req)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json(origin,{error:"Use POST."},405);
  if(!allowedOrigin(origin))return json(origin,{error:"Origem não autorizada."},403);
  const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:auth}=await db.auth.getUser(bearer);
  if(!auth.user)return json(origin,{error:"Sessão administrativa inválida."},401);
  const {data:admin}=await db.from("admin_users").select("user_id").eq("user_id",auth.user.id).maybeSingle();
  if(!admin)return json(origin,{error:"Acesso administrativo necessário."},403);

  const input=await req.json().catch(()=>({}));
  const requested=Array.isArray(input.itens_json)?input.itens_json:[];
  if(!requested.length)return json(origin,{error:"Adicione pelo menos um produto."},400);
  const ids=requested.map((i:any)=>String(i.id||""));
  const {data:products,error:productError}=await db.from("produtos").select("id,nome,preco,custo,estoque,bling_id,tipo_produto,unidades_por_kit").in("id",ids).eq("excluido",false);
  if(productError||!products)return json(origin,{error:"Não foi possível conferir os produtos."},500);
  const {data:componentRows,error:componentError}=await db.from("produto_componentes").select("kit_id,componente_id,quantidade,componente:produtos!produto_componentes_componente_id_fkey(id,nome,bling_id,preco)").in("kit_id",ids);
  if(componentError)return json(origin,{error:"Não foi possível conferir a composição dos kits."},500);
  const lines=[] as any[];
  for(const item of requested){
    const p=products.find((x:any)=>String(x.id)===String(item.id)); const q=Math.trunc(Number(item.quantidade||0));
    if(!p||q<1)return json(origin,{error:"Produto ou quantidade inválida."},400);
    if(Number(p.estoque||0)<q)return json(origin,{error:`Estoque insuficiente para ${p.nome}.`},409);
    const componentes=p.tipo_produto==="kit"?(componentRows||[]).filter((row:any)=>String(row.kit_id)===String(p.id)).map((row:any)=>({id:row.componente_id,nome:row.componente?.nome,bling_id:row.componente?.bling_id?String(row.componente.bling_id):null,preco_referencia:Number(row.componente?.preco||0),quantidade:Number(row.quantidade||0)})):[];
    if(p.tipo_produto==="kit"&&!componentes.length)return json(origin,{error:`O kit ${p.nome} está sem composição.`},409);
    lines.push({id:p.id,nome:p.nome,preco:Number(p.preco||0),quantidade:q,bling_id:p.bling_id,tipo_produto:p.tipo_produto||"unitario",unidades_por_kit:Number(p.unidades_por_kit||1),componentes});
  }
  const frete=Math.max(0,Number(input.frete||0)), desconto=Math.max(0,Number(input.desconto||0));
  const subtotal=lines.reduce((s,i)=>s+i.preco*i.quantidade,0), total=Math.max(0,Number((subtotal+frete-desconto).toFixed(2)));
  const reference=crypto.randomUUID(), tracking=crypto.randomUUID(), name=String(input.cliente_nome||"Balcão").trim()||"Balcão";
  const payment=String(input.pagamento||"Pix");
  const order:any={referencia:reference,tracking_token:tracking,cliente:name+(input.cliente_telefone?` (${digits(input.cliente_telefone)})`:""),cliente_nome:name,cliente_telefone:digits(input.cliente_telefone)||null,cliente_email:String(input.cliente_email||"").trim()||null,cliente_cpf:digits(input.cliente_cpf).slice(0,11)||null,itens:lines.map(i=>`${i.nome} (x${i.quantidade})`).join(", ")+(desconto?` [DESCONTO: R$ ${desconto.toFixed(2)}]`:""),itens_json:lines,total,custo:products.reduce((s:any,p:any)=>s+Number(p.custo||0)*Number(requested.find((i:any)=>String(i.id)===String(p.id))?.quantidade||0),0),pagamento:payment,pagamento_metodo:payment.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace("cartao","visa"),pagamento_parcelas:1,status_pagamento:"pago",status:"Concluído",concluido_em:new Date().toISOString(),frete,endereco:String(input.endereco||"Balcão"),frete_detalhes:{origem:"pdv",embalagem_id:input.embalagem_id||null}};
  const {data:created,error:insertError}=await db.from("pedidos").insert(order).select("id,referencia").single();
  if(insertError||!created)return json(origin,{error:insertError?.message||"Não foi possível registrar a venda."},500);
  const {error:reserveError}=await db.rpc("reservar_estoque_pedido",{p_referencia:reference});
  if(reserveError){await db.from("pedidos").delete().eq("id",created.id);return json(origin,{error:reserveError.message},409);}
  let embalagem=null;
  if(input.embalagem_id){const result=await db.rpc("baixar_embalagem_pdv",{p_pedido_id:created.id,p_referencia:reference,p_embalagem_id:String(input.embalagem_id)});if(result.error)return json(origin,{error:`Venda registrada, mas a embalagem não foi baixada: ${result.error.message}`,pedido_id:created.id},409);embalagem=result.data;}
  await db.from("pedidos").update({frete_detalhes:{origem:"pdv",embalagem_id:input.embalagem_id||null,embalagem_nome:embalagem?.nome||null,embalagem_baixada:Boolean(input.embalagem_id)}}).eq("id",created.id);
  const secret=Deno.env.get("BLING_SYNC_SECRET")||"";
  const sync=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-sync`,{method:"POST",headers:{"content-type":"application/json","x-bling-sync-secret":secret},body:JSON.stringify({action:"pedido",referencia:reference})});
  const syncData=await sync.json().catch(()=>({}));
  if(!sync.ok)return json(origin,{error:`Venda salva e estoque local baixado, mas o Bling recusou: ${syncData.error||"falha de sincronização"}`,pedido_id:created.id,referencia:reference,embalagem},502);
  let nota=null;
  if(input.emitir_nfe===true){
    const headers={authorization:`Bearer ${bearer}`,"content-type":"application/json"};
    const review=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-nfe`,{method:"POST",headers,body:JSON.stringify({action:"revisar",pedido_id:created.id})});
    const reviewData=await review.json().catch(()=>({}));
    if(!review.ok)return json(origin,{error:`Venda e estoque sincronizados, mas a NF-e não pôde ser revisada: ${reviewData.error||"falha fiscal"}`,pedido_id:created.id,referencia:reference,bling_id:syncData.bling_id},502);
    const env=String(reviewData.ambiente_fiscal||"");
    const issue=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bling-nfe`,{method:"POST",headers,body:JSON.stringify({action:"emitir",pedido_id:created.id,natureza_chave:"consumidor_final",confirmar_ambiente:env,enviar_email:input.enviar_email===true})});
    const issueData=await issue.json().catch(()=>({}));
    if(!issue.ok)return json(origin,{error:`Venda e estoque sincronizados, mas a NF-e falhou: ${issueData.error||"falha fiscal"}`,pedido_id:created.id,referencia:reference,bling_id:syncData.bling_id},502);
    nota=issueData.nota;
  }
  return json(origin,{ok:true,pedido_id:created.id,referencia:reference,bling_id:syncData.bling_id,estoque_bling:Boolean(syncData.estoque_bling),embalagem,nota});
});

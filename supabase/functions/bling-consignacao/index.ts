import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE="https://api.bling.com.br/Api/v3";
const NATURES:Record<string,{env:string,nome:string}>={
  remessa:{env:"BLING_NATURE_CONSIGNACAO_REMESSA_ID",nome:"Remessa em consignação"},
  venda:{env:"BLING_NATURE_CONSIGNACAO_VENDA_ID",nome:"Venda de mercadoria consignada"},
  devolucao:{env:"BLING_NATURE_CONSIGNACAO_DEVOLUCAO_ID",nome:"Retorno/devolução de consignação"}
};
const allowed=(origin:string|null)=>{if(!origin)return true;try{const u=new URL(origin);return u.protocol==="https:"&&(u.hostname==="tionan.com.br"||u.hostname==="www.tionan.com.br"||u.hostname.endsWith(".vercel.app"))||u.protocol==="http:"&&(u.hostname==="localhost"||u.hostname==="127.0.0.1"||u.hostname==="192.168.1.36")}catch{return false}};
const cors=(o:string|null)=>({"access-control-allow-origin":o&&allowed(o)?o:"https://www.tionan.com.br","access-control-allow-headers":"authorization, x-client-info, apikey, content-type","access-control-allow-methods":"POST, OPTIONS",vary:"Origin"});
const json=(o:string|null,b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors(o),"content-type":"application/json; charset=utf-8"}});
const authorized=(s:unknown)=>[5,6].includes(Number(s));
const publicNote=(r:any)=>{const d=r?.data||r||{};return{id:String(d.id||""),numero:String(d.numero||""),situacao:String(d.situacao??""),chave_acesso:String(d.chaveAcesso||""),tem_danfe:authorized(d.situacao)&&Boolean(d.chaveAcesso),tem_xml:authorized(d.situacao)&&Boolean(d.chaveAcesso)}};
const detail=(d:any,s:number)=>d?.error?.fields?.map?.((f:any)=>`${f.element||"campo"}: ${f.msg||f.message||"inválido"}`).join("; ")||d?.error?.description||d?.message||`Erro Bling (${s})`;

Deno.serve(async req=>{
  const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});if(req.method!=="POST")return json(origin,{error:"Use POST."},405);if(!allowed(origin))return json(origin,{error:"Origem não autorizada."},403);
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"").trim()||"";
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:auth}=await db.auth.getUser(token);if(!auth.user)return json(origin,{error:"Sessão administrativa inválida."},401);
  const {data:admin}=await db.from("admin_users").select("user_id").eq("user_id",auth.user.id).maybeSingle();if(!admin)return json(origin,{error:"Acesso administrativo necessário."},403);
  const input=await req.json().catch(()=>({})),action=String(input.action||""),id=String(input.movimento_id||"");
  if(!id||!["revisar","emitir","consultar","documento"].includes(action))return json(origin,{error:"Ação ou movimentação inválida."},400);
  const {data:mov,error}=await db.from("consignacao_movimentos").select("*,consignacao_empresas(*),consignacao_itens(*)").eq("id",id).single();
  if(error||!mov)return json(origin,{error:"Movimentação não encontrada."},404);if(mov.status!=="ativo")return json(origin,{error:"A movimentação está estornada."},409);
  const nature=NATURES[mov.tipo];if(!nature)return json(origin,{error:"Natureza de consignação inválida."},400);
  const natureId=Deno.env.get(nature.env)||"",environment=String(Deno.env.get("BLING_NFE_ENVIRONMENT")||"").toLowerCase();
  const company=mov.consignacao_empresas,items=mov.consignacao_itens||[];
  const summary=()=>({tipo:mov.tipo,empresa:company?.nome_fantasia||company?.nome,data:mov.data_movimento,itens:items.map((i:any)=>({nome:i.produto_nome,quantidade:i.quantidade,valor:i.valor_unitario})),nota:mov.bling_nfe_id?{id:mov.bling_nfe_id,numero:mov.bling_nfe_numero,situacao:mov.bling_nfe_status,chave_acesso:mov.bling_nfe_chave_acesso,tem_danfe:authorized(mov.bling_nfe_status)&&Boolean(mov.bling_nfe_chave_acesso),tem_xml:authorized(mov.bling_nfe_status)&&Boolean(mov.bling_nfe_chave_acesso)}:null});
  if(action==="revisar")return json(origin,{ok:true,movimento:summary(),natureza_nome:nature.nome,natureza_configurada:/^\d+$/.test(natureId),ambiente_fiscal:environment||"nao_configurado"});
  if(!/^\d+$/.test(natureId))return json(origin,{error:`A natureza “${nature.nome}” não está configurada no servidor.`},409);
  const {data:conn}=await db.from("bling_integracao").select("access_token,refresh_token,expires_at").eq("id","principal").single();if(!conn?.access_token)return json(origin,{error:"Bling ainda não está conectado."},409);
  let access=conn.access_token;
  if(conn.expires_at&&new Date(conn.expires_at)<=new Date(Date.now()+60000)){const credentials=btoa(`${Deno.env.get("BLING_CLIENT_ID")}:${Deno.env.get("BLING_CLIENT_SECRET")}`);const rr=await fetch(`${API_BASE}/oauth/token`,{method:"POST",headers:{authorization:`Basic ${credentials}`,"content-type":"application/x-www-form-urlencoded","enable-jwt":"1"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:conn.refresh_token})});const t=await rr.json().catch(()=>({}));if(!rr.ok)return json(origin,{error:"Não foi possível renovar a conexão com o Bling."},401);access=t.access_token;await db.from("bling_integracao").update({access_token:t.access_token,refresh_token:t.refresh_token||conn.refresh_token,expires_at:new Date(Date.now()+Number(t.expires_in||3600)*1000).toISOString(),atualizado_em:new Date().toISOString()}).eq("id","principal")}
  const bling=async(path:string,init:RequestInit={})=>{const r=await fetch(`${API_BASE}${path}`,{...init,headers:{authorization:`Bearer ${access}`,accept:"application/json","enable-jwt":"1",...(init.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(detail(d,r.status));return d};
  const persist=async(raw:any)=>{const n=publicNote(raw);await db.from("consignacao_movimentos").update({bling_nfe_id:n.id||mov.bling_nfe_id,bling_nfe_numero:n.numero||null,bling_nfe_status:n.situacao||"gerada",bling_nfe_chave_acesso:n.chave_acesso||null,bling_nfe_erro:null}).eq("id",id);return n};
  try{
    let noteId=String(mov.bling_nfe_id||"");
    if(action==="emitir"){
      if(!["homologacao","producao"].includes(environment)||String(input.confirmar_ambiente)!==environment)return json(origin,{error:"Confirme o ambiente fiscal configurado antes de emitir."},409);
      const contatoId=String(input.contato_id||company?.bling_contato_id||"");
      if(!/^\d+$/.test(contatoId))return json(origin,{error:"Não foi possível vincular esta empresa ao contato do Bling."},409);
      if(contatoId!==String(company?.bling_contato_id||""))await db.from("consignacao_empresas").update({bling_contato_id:contatoId,atualizado_em:new Date().toISOString()}).eq("id",company.id);
      if(!noteId){let saleId=String(mov.bling_pedido_id||"");if(!saleId){const total=items.reduce((s:number,i:any)=>s+Number(i.quantidade)*Number(i.valor_unitario),0);const payload={data:mov.data_movimento,numeroLoja:`CONS-${id.slice(0,8).toUpperCase()}`,contato:{id:Number(contatoId)},observacoes:`${nature.nome} — controle Tio Nan ${id}`,itens:items.map((i:any)=>({produto:{id:Number(i.produto_bling_id)},naturezaOperacao:{id:Number(natureId)},descricao:i.produto_nome,unidade:"UN",quantidade:Number(i.quantidade),valor:Number(i.valor_unitario)})),parcelas:mov.tipo==="venda"?[{dataVencimento:mov.data_movimento,valor:total}]:[]};const created=await bling("/pedidos/vendas",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});saleId=String(created?.data?.id||created?.id||"");if(!saleId)throw new Error("O Bling não retornou o pedido fiscal.");await db.from("consignacao_movimentos").update({bling_pedido_id:saleId}).eq("id",id)}
        const generated=await bling(`/pedidos/vendas/${encodeURIComponent(saleId)}/gerar-nfe`,{method:"POST"});noteId=String(generated?.data?.idNotaFiscal||generated?.idNotaFiscal||generated?.data?.id||generated?.id||"");if(!noteId)throw new Error("O Bling gerou a nota, mas não retornou o identificador.");await db.from("consignacao_movimentos").update({bling_nfe_id:noteId,bling_nfe_status:"gerada"}).eq("id",id)}
      await bling(`/nfe/${encodeURIComponent(noteId)}/enviar`,{method:"POST"});const nr=await bling(`/nfe/${encodeURIComponent(noteId)}`);return json(origin,{ok:true,nota:await persist(nr)});
    }
    if(!noteId)return json(origin,{error:"Esta movimentação ainda não possui NF-e."},404);
    const nr=await bling(`/nfe/${encodeURIComponent(noteId)}`),note=await persist(nr);if(action==="consultar")return json(origin,{ok:true,nota:note});
    const formato=String(input.formato||"").toLowerCase();if(!["pdf","xml"].includes(formato)||!note.chave_acesso)return json(origin,{error:"Documento ainda não disponível."},409);
    const dr=await fetch(`${API_BASE}/nfe/documento/${encodeURIComponent(note.chave_acesso)}?formato=${formato}`,{headers:{authorization:`Bearer ${access}`,accept:"application/json","enable-jwt":"1"}});const dj=await dr.json().catch(()=>({}));if(!dr.ok)throw new Error(detail(dj,dr.status));const encoded=String(Array.isArray(dj?.data)?dj.data[0]?.conteudo||"":"");if(!encoded)throw new Error("O Bling não retornou o documento.");const compressed=Uint8Array.from(atob(encoded),(c)=>c.charCodeAt(0));const bytes=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();return new Response(bytes,{headers:{...cors(origin),"content-type":formato==="pdf"?"application/pdf":"application/xml","content-disposition":`attachment; filename=Consignacao-${id.slice(0,8)}.${formato}`}})
  }catch(e){const message=e instanceof Error?e.message:"Falha na integração fiscal.";await db.from("consignacao_movimentos").update({bling_nfe_erro:message}).eq("id",id);return json(origin,{error:message},422)}
});

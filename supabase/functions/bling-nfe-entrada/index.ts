import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API="https://api.bling.com.br/Api/v3";
const allowed=(origin:string|null)=>{if(!origin)return true;try{const h=new URL(origin).hostname;return ["tionan.com.br","www.tionan.com.br","localhost","127.0.0.1","192.168.1.36","192.168.0.102"].includes(h)||h.endsWith(".vercel.app")}catch{return false}};
const cors=(origin:string|null)=>({"access-control-allow-origin":origin&&allowed(origin)?origin:"https://www.tionan.com.br","access-control-allow-headers":"authorization, apikey, content-type","access-control-allow-methods":"POST, OPTIONS",vary:"Origin"});
const json=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),"content-type":"application/json; charset=utf-8"}});
const detail=(data:any,status:number)=>data?.error?.fields?.map?.((x:any)=>`${x.element||"campo"}: ${x.msg||x.message||"inválido"}`).join("; ")||data?.error?.description||data?.message||`Erro Bling (${status})`;
const publicNote=(raw:any)=>{const n=raw?.data||raw||{};return {id:String(n.id||""),numero:String(n.numero||""),serie:String(n.serie||""),situacao:String(n.situacao??""),chave_acesso:String(n.chaveAcesso||""),data_emissao:n.dataEmissao||null}};

Deno.serve(async(request)=>{
  const origin=request.headers.get("origin");
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(request.method!=="POST"||!allowed(origin))return json(origin,{error:"Requisição não autorizada."},403);
  const userToken=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:auth}=await db.auth.getUser(userToken);
  if(!auth.user)return json(origin,{error:"Entre novamente no painel."},401);
  const {data:admin}=await db.from("admin_users").select("user_id").eq("user_id",auth.user.id).maybeSingle();
  if(!admin)return json(origin,{error:"Acesso administrativo necessário."},403);
  const input=await request.json().catch(()=>({}));
  const id=String(input.id||""); const action=String(input.action||"");
  if(!id||!["criar_no_bling","emitir","consultar"].includes(action))return json(origin,{error:"Ação inválida."},400);
  const {data:entry,error:entryError}=await db.from("nfe_entradas_proprias").select("*").eq("id",id).single();
  if(entryError||!entry)return json(origin,{error:"Rascunho não encontrado."},404);
  const {data:connection}=await db.from("bling_integracao").select("access_token,refresh_token,expires_at").eq("id","principal").single();
  if(!connection?.access_token)return json(origin,{error:"Bling ainda não está conectado."},409);
  let access=connection.access_token;
  if(connection.expires_at&&new Date(connection.expires_at)<=new Date(Date.now()+60000)){
    const clientId=Deno.env.get("BLING_CLIENT_ID")||"";const secret=Deno.env.get("BLING_CLIENT_SECRET")||"";
    const response=await fetch(`${API}/oauth/token`,{method:"POST",headers:{authorization:`Basic ${btoa(`${clientId}:${secret}`)}`,"content-type":"application/x-www-form-urlencoded","enable-jwt":"1"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:connection.refresh_token})});
    const token=await response.json().catch(()=>({}));if(!response.ok)return json(origin,{error:"Não foi possível renovar a conexão com o Bling."},401);
    access=token.access_token;await db.from("bling_integracao").update({access_token:access,refresh_token:token.refresh_token||connection.refresh_token,expires_at:new Date(Date.now()+Number(token.expires_in||3600)*1000).toISOString(),atualizado_em:new Date().toISOString()}).eq("id","principal");
  }
  const bling=async(path:string,init:RequestInit={})=>{const response=await fetch(`${API}${path}`,{...init,headers:{authorization:`Bearer ${access}`,accept:"application/json","enable-jwt":"1",...(init.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(detail(data,response.status));return data};
  const persist=async(raw:any,status?:string)=>{const n=publicNote(raw);await db.from("nfe_entradas_proprias").update({status:status||(["5","6"].includes(n.situacao)?"autorizada":"no_bling"),bling_nfe_id:n.id||entry.bling_nfe_id,bling_nfe_numero:n.numero||null,bling_nfe_serie:n.serie||null,bling_nfe_chave_acesso:n.chave_acesso||null,bling_nfe_situacao:n.situacao||null,bling_erro:null,atualizado_em:new Date().toISOString(),autorizado_em:["5","6"].includes(n.situacao)?new Date().toISOString():entry.autorizado_em}).eq("id",id);return n};
  try{
    let noteId=String(entry.bling_nfe_id||"");
    if(action==="criar_no_bling"){
      if(noteId)return json(origin,{error:"A nota já possui rascunho no Bling. Use Consultar."},409);
      const nature=String(Deno.env.get("BLING_NATURE_ENTRADA_COMPRA_ID")||"");
      if(!/^\d+$/.test(nature))return json(origin,{error:"Configure BLING_NATURE_ENTRADA_COMPRA_ID com a natureza de compra definida pelo contador."},409);
      const itens=Array.isArray(entry.itens)?entry.itens:[];
      if(!itens.length)return json(origin,{error:"Inclua ao menos um produto."},422);
      const aliquota=Number(entry.aliquota_icms||0);const base=Number(entry.base_icms||0);const valor=Number(entry.valor_icms||0);
      const payload:any={tipo:0,dataOperacao:entry.data_operacao,finalidade:1,naturezaOperacao:{id:Number(nature)},contato:entry.fornecedor_bling_id?{id:Number(entry.fornecedor_bling_id)}:{nome:entry.fornecedor_nome,tipoPessoa:String(entry.fornecedor_documento||"").replace(/\D/g,"").length===14?"J":"F",numeroDocumento:String(entry.fornecedor_documento||"").replace(/\D/g,""),ie:entry.fornecedor_ie||undefined,email:entry.fornecedor_email||undefined,telefone:entry.fornecedor_telefone||undefined},itens:itens.map((item:any)=>({produto:{id:Number(item.bling_id)},codigo:String(item.codigo||""),descricao:String(item.descricao||""),unidade:String(item.unidade||"UN"),quantidade:Number(item.quantidade||0),valor:Number(item.valor||0),tipo:"P",naturezaOperacao:{id:Number(nature)},tributacao:{icms:{baseCalculo:base,aliquota,valor}}})),observacoes:[entry.observacoes,`ICMS informado para conferência: base R$ ${base.toFixed(2)}, alíquota ${aliquota.toFixed(2)}%, valor R$ ${valor.toFixed(2)}.`].filter(Boolean).join("\n")};
      const created=await bling("/nfe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      noteId=String(created?.data?.id||created?.id||"");if(!noteId)throw new Error("O Bling não retornou o identificador da NF-e de entrada.");
      const note=await persist(await bling(`/nfe/${encodeURIComponent(noteId)}`),"no_bling");return json(origin,{ok:true,nota:note,aviso:"Rascunho criado. Confira o destaque do ICMS antes de emitir."});
    }
    if(!noteId)return json(origin,{error:"Crie primeiro o rascunho no Bling."},409);
    if(action==="emitir"){
      const environment=String(Deno.env.get("BLING_NFE_ENVIRONMENT")||"").toLowerCase();
      if(!["homologacao","producao"].includes(environment)||String(input.confirmar_ambiente||"")!==environment)return json(origin,{error:"Confirme explicitamente o ambiente fiscal antes de emitir."},409);
      await bling(`/nfe/${encodeURIComponent(noteId)}/enviar?enviarEmail=false`,{method:"POST"});
    }
    const note=await persist(await bling(`/nfe/${encodeURIComponent(noteId)}`));return json(origin,{ok:true,nota:note});
  }catch(error){const message=error instanceof Error?error.message:String(error);await db.from("nfe_entradas_proprias").update({status:"erro",bling_erro:message,atualizado_em:new Date().toISOString()}).eq("id",id);return json(origin,{error:message},422)}
});

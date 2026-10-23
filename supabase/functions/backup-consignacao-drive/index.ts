import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const encoder=new TextEncoder();
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,"0")).join("");

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"Use POST."},405);
  const configured=String(Deno.env.get("BACKUP_SECRET")||"");
  const supplied=String(req.headers.get("x-backup-secret")||"");
  if(!configured||supplied!==configured)return json({error:"Backup não autorizado."},401);
  const input=await req.json().catch(()=>({}));
  const action=String(input.action||"");
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if(action==="preparar"){
    const tables=["consignacao_empresas","consignacao_movimentos","consignacao_itens","consignacao_acertos","consignacao_alocacoes","consignacao_pagamentos","consignacao_auditoria"];
    const data:Record<string,unknown[]>={};
    try{
      for(const table of tables){
        const rows:unknown[]=[];
        for(let from=0;;from+=1000){
          const result=await db.from(table).select("*").range(from,from+999);
          if(result.error)throw result.error;
          rows.push(...(result.data||[]));
          if((result.data||[]).length<1000)break;
        }
        data[table]=rows;
      }
      const generated=new Date();
      const payload={formato:"tio-nan-consignacao",versao:2,gerado_em:generated.toISOString(),observacao:"Backup automático integral. Contém dados pessoais e fiscais; arquivo privado.",...data};
      const content=JSON.stringify(payload,null,2);
      const checksum=hex(await crypto.subtle.digest("SHA-256",encoder.encode(content)));
      const stamp=generated.toISOString().replace(/[:.]/g,"-");
      const record=await db.from("consignacao_backups").insert({origem:"automatico",status:"processando",arquivo_nome:`backup-consignacao-tio-nan_${stamp}.json`,total_empresas:data.consignacao_empresas.length,total_movimentos:data.consignacao_movimentos.length,total_pagamentos:data.consignacao_pagamentos.length,total_auditoria:data.consignacao_auditoria.length,tamanho_bytes:encoder.encode(content).length,integridade_sha256:checksum}).select("id,arquivo_nome").single();
      if(record.error)throw record.error;
      return json({ok:true,backup_id:record.data.id,arquivo_nome:record.data.arquivo_nome,conteudo:content,integridade_sha256:checksum});
    }catch(error){return json({error:error instanceof Error?error.message:"Falha ao preparar backup."},500)}
  }

  if(action==="concluir"){
    const id=String(input.backup_id||"");
    if(!id)return json({error:"Backup inválido."},400);
    const update=await db.from("consignacao_backups").update({status:"concluido",arquivo_id:String(input.arquivo_id||""),arquivo_url:String(input.arquivo_url||""),concluido_em:new Date().toISOString(),mensagem_erro:null}).eq("id",id);
    if(update.error)return json({error:update.error.message},500);
    return json({ok:true});
  }

  if(action==="falhar"){
    const id=String(input.backup_id||"");
    if(id)await db.from("consignacao_backups").update({status:"erro",mensagem_erro:String(input.mensagem_erro||"Falha não informada").slice(0,1000),concluido_em:new Date().toISOString()}).eq("id",id);
    return json({ok:true});
  }
  return json({error:"Ação inválida."},400);
});

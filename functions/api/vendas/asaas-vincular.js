/* AV360: vínculo Asaas verificado no servidor, sem cobrança nem liberação automática. */
const answer=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"}});
export async function onRequestPost({request,env}){
 const authorization=String(request.headers.get("Authorization")||"");
 if(!/^Bearer\s+\S+$/i.test(authorization))return answer({ok:false,error:"SESSAO_ADMIN_OBRIGATORIA"},401);
 const url=String(env.AV_SUPABASE_URL||env.SUPABASE_URL||"").replace(/\/$/,"");
 const key=String(env.AV_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||"");
 if(!url.startsWith("https://")||!key)return answer({ok:false,error:"AUTH_NAO_CONFIGURADO"},503);
 let user;
 try{
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:key,Authorization:authorization},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!r.ok)return answer({ok:false,error:"SESSAO_INVALIDA"},401);
  user=await r.json();
 }catch{return answer({ok:false,error:"AUTH_INDISPONIVEL"},503);}
 const admin=String(env.AV_ADMIN_EMAIL||env.ADMIN_EMAIL||"avrep.tech@gmail.com").trim().toLowerCase();
 if(!user?.id||String(user.email||"").trim().toLowerCase()!==admin)return answer({ok:false,error:"ADMIN_NAO_AUTORIZADO"},403);
 let data;
 try{data=await request.json();}catch{return answer({ok:false,error:"JSON_INVALIDO"},400);}
 const empresa=String(data?.empresa_id||""),customer=String(data?.asaas_customer_id||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(empresa)||
    !/^cus_[A-Za-z0-9_-]{5,80}$/.test(customer)||
    data?.confirmacao!=="CONFERI_CADASTRO_ASAAS")return answer({ok:false,error:"DADOS_VINCULO_INVALIDOS"},400);
 const target=String(env.AV_VENDAS_N8N_ADMIN_URL||""),secret=String(env.AV_VENDAS_N8N_ADMIN_SHARED_SECRET||"");
 if(!/^https:\/\/[^/]+\/webhook\//i.test(target)||!secret)return answer({ok:false,error:"PONTE_ADMIN_NAO_CONFIGURADA"},503);
 let c;
 try{
  const r=await fetch("https://possessivebull-n8n.cloudfy.live/webhook/av360-admin-asaas-clientes-jwt-v1",{method:"POST",headers:{"Content-Type":"application/json",Authorization:authorization},body:"{}",cache:"no-store",signal:AbortSignal.timeout(55000)});
  if(!r.ok)return answer({ok:false,error:"CONFERENCIA_ASAAS_INDISPONIVEL"},502);
  const listing=await r.json();
  if(listing?.ok!==true||listing?.parcial===true)return answer({ok:false,error:"CONFERENCIA_ASAAS_INCOMPLETA"},409);
  c=(listing.clientes||[]).find(x=>x.asaas_customer_id===customer);
 }catch{return answer({ok:false,error:"CONFERENCIA_ASAAS_INDISPONIVEL"},503);}
 if(!c||c.status_integracao!=="APTO_PARA_VINCULAR"||c.possivel_empresa_id!==empresa||![11,14].includes(String(c.documento||"").length)){
  return answer({ok:false,error:"CLIENTE_SEM_VINCULO_VERIFICADO"},409);
 }
 try{
  const body={acao:"vincular_asaas",empresa_id:empresa,asaas_customer_id:customer,documento_asaas:c.documento,ambiente:"PRODUCAO",confirmacao:"CONFERI_CADASTRO_ASAAS"};
  const r=await fetch(target,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","X-AV-Bridge-Secret":secret},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(25000)});
  const raw=await r.json().catch(()=>null),result=raw?.result??raw;
  if(!r.ok||result?.ok!==true)return answer({ok:false,error:String(result?.error||result?.erro||"VINCULO_NAO_CONFIRMADO")},r.ok?400:502);
  return answer({ok:true,empresa_id:empresa,asaas_customer_id:customer,carteira_criada_ou_existente:result.carteira_criada_ou_existente===true,acesso_liberado:result.acesso_liberado===true});
 }catch{return answer({ok:false,error:"FALHA_PERSISTIR_VINCULO"},503);}
}
export function onRequestGet(){return answer({ok:false,error:"METODO_NAO_PERMITIDO"},405);}

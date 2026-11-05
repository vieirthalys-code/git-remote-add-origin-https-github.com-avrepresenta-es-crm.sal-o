/* AV360 | API administrativa: consulta clientes Asaas (somente AV, nunca libera acesso). */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"}});
export async function onRequestGet({request,env}){
 const token=String(request.headers.get("Authorization")||"");
 if(!/^Bearer\\s+[^\\s]+$/i.test(token))return json({ok:false,error:"SESSAO_ADMIN_OBRIGATORIA"},401);
 const url=String(env.AV_SUPABASE_URL||env.SUPABASE_URL||"").replace(/\\/$/,"");
 const key=String(env.AV_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||"");
 if(!url.startsWith("https://")||!key)return json({ok:false,error:"AUTH_NAO_CONFIGURADO"},503);
 let user;
 try{
  const auth=await fetch(url+"/auth/v1/user",{headers:{"apikey":key,"Authorization":token},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!auth.ok)return json({ok:false,error:"SESSAO_INVALIDA"},401);
  user=await auth.json();
 }catch{return json({ok:false,error:"SERVICO_AUTH_INDISPONIVEL"},503);}
 const admin=String(env.AV_ADMIN_EMAIL||env.ADMIN_EMAIL||"avrep.tech@gmail.com").trim().toLowerCase();
 if(!user?.id||String(user.email||"").trim().toLowerCase()!==admin)return json({ok:false,error:"ADMIN_NAO_AUTORIZADO"},403);
 try{
  const r=await fetch("https://possessivebull-n8n.cloudfy.live/webhook/av360-admin-asaas-clientes-jwt-v1",{method:"POST",headers:{"Content-Type":"application/json","Authorization":token},body:"{}",cache:"no-store",signal:AbortSignal.timeout(55000)});
  if(!r.ok)return json({ok:false,error:r.status===403?"ADMIN_NAO_AUTORIZADO":"CONSULTA_ASAAS_INDISPONIVEL"},r.status===403?403:502);
  const a=await r.json();
  if(a?.ok!==true||!Array.isArray(a.clientes))return json({ok:false,error:"RESPOSTA_ASAAS_INVALIDA"},502);
  return json(a);
 }catch{return json({ok:false,error:"FALHA_CONSULTA_ASAAS"},503);}
}
export function onRequestPost(){return json({ok:false,error:"METODO_NAO_PERMITIDO"},405);}

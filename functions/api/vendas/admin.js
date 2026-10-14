/* Cloudflare Pages Function: ponte autenticada Admin AV -> n8n -> PostgreSQL Cloudfy.
   Não conecta em REST do Supabase para os dados do CRM Vendas (eles estão na Cloudfy).
   Secret do n8n jamais é enviado ao navegador. */
function reply(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
const fail=(error,status=400)=>reply({ok:false,error},status);
const actions=new Set(['listar','saldo','recarga','politica','teste','encerrar_teste','prompt']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function onRequestPost({request,env}){
 const url=String(env.AV_SUPABASE_URL||env.SUPABASE_URL||'').replace(/\/$/,'');
 const publishable=env.AV_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
 const target=String(env.AV_VENDAS_N8N_ADMIN_URL||'');
 const secret=env.AV_VENDAS_N8N_ADMIN_SHARED_SECRET;
 if(!url||!publishable||!target||!secret) return fail('Faltam configurações de servidor para o CRM Vendas (veja o LEIA-ME).',503);
 if(!/^https:\/\/[^/]+\/webhook\//i.test(target))return fail('URL segura do webhook não configurada.',503);
 const authorization=request.headers.get('Authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(authorization))return fail('Autenticação administrativa necessária.',401);
 let user;
 try{
   const res=await fetch(`${url}/auth/v1/user`,{headers:{apikey:publishable,Authorization:authorization},cache:'no-store'});
   if(!res.ok)return fail('Sessão do Admin inválida ou expirada.',401);
   user=await res.json();
 }catch{return fail('Falha na validação do login administrativo.',502);}
 if(!user?.id||String(user?.email||'').toLowerCase().trim()!==String(env.AV_ADMIN_EMAIL||'avrep.tech@gmail.com').toLowerCase().trim())return fail('Administrador não autorizado.',403);
 let payload;
 try{payload=await request.json();}catch{return fail('JSON inválido.');}
 if(!payload||!actions.has(payload.acao))return fail('Ação inválida.');
 if(payload.acao!=='listar' && (!uuid.test(String(payload.empresa_id||''))))return fail('UUID da empresa inválido.');
 if(payload.acao==='recarga'){
   if(!Number.isFinite(payload.valor_reais)||payload.valor_reais<=0||payload.valor_reais>1000000||Math.abs(Math.round(payload.valor_reais*100)-payload.valor_reais*100)>1e-6)return fail('Recarga deve ter valor positivo com até duas casas decimais.');
   if(!uuid.test(String(payload.referencia||'')))return fail('Identificador da recarga inválido.');
 }
 try{
  const res=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','X-AV-Bridge-Secret':secret},body:JSON.stringify(payload),cache:'no-store'});
  const data=await res.json().catch(()=>null);
  if(!res.ok)return fail(`Gateway Vendas indisponível (HTTP ${res.status}).`,502);
  const obj=data?.result??data;
  if(!obj||typeof obj!=='object')return fail('Gateway não retornou JSON válido.',502);
  if(obj.ok===false)return reply(obj,400);
  return reply(obj);
 }catch{return fail('Não foi possível comunicar com o PostgreSQL via n8n.',502);}
}
export function onRequestGet(){return fail('Use POST autenticado.',405);}

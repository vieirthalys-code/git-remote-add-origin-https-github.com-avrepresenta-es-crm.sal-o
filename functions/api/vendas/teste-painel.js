/* AV360 | Controle de teste temporario pelo Painel Administrativo AV.
 * Autenticacao Supabase + aprovacao admin; n8n tem Header Auth separado.
 * Nunca recebe senha, nunca altera cobrancas Asaas ou comprovantes fiscais. */
const result=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'
}});
const reject=(error,status=400)=>result({ok:false,error},status);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asaas=/^cus_[a-zA-Z0-9_-]{5,80}$/;
export async function onRequestPost({request,env}){
  const supabaseUrl=String(env.AV_SUPABASE_URL||env.SUPABASE_URL||'').replace(/\/$/,'');
  const supabaseKey=env.AV_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  const adminEmail=String(env.AV_ADMIN_EMAIL||'avrep.tech@gmail.com').trim().toLowerCase();
  const secret=env.AV_VENDAS_N8N_ADMIN_SHARED_SECRET;
  const base=String(env.AV_VENDAS_N8N_ADMIN_URL||'');
  if(!supabaseUrl||!supabaseKey||!secret||!base)return reject('A integracao administrativa nao esta configurada no servidor.',503);
  const bearer=String(request.headers.get('Authorization')||'');
  if(!/^Bearer\s+\S+$/i.test(bearer))return reject('Faca login como administrador AV.',401);
  let user;
  try{
    const auth=await fetch(supabaseUrl+'/auth/v1/user',{headers:{apikey:supabaseKey,Authorization:bearer},cache:'no-store'});
    if(!auth.ok)return reject('Sessao expirada ou invalida.',401);
    user=await auth.json();
  }catch{return reject('Falha na verificacao de identidade do administrador.',502);}
  if(!uuid.test(String(user?.id||''))||String(user?.email||'').trim().toLowerCase()!==adminEmail)
    return reject('Apenas a conta administrativa AV pode liberar testes.',403);
  let body;
  try{body=await request.json();}catch{return reject('Dados JSON invalidos.');}
  if(!body||!uuid.test(String(body.empresa_id||''))||!['iniciar','encerrar'].includes(body.acao))
    return reject('Operacao ou empresa invalida.');
  if(!asaas.test(String(body.asaas_customer_id||''))||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email_login||''))||
     String(body.email_login||'').length>254)
    return reject('Confira a conta de login e o vinculo Asaas.');
  if(body.acao==='iniciar' && (!Number.isInteger(body.dias)||body.dias<1||body.dias>30))
    return reject('Escolha de 1 a 30 dias de teste.');
  if(body.confirmacao!==(body.acao==='iniciar'?'LIBERAR_TESTE_ADMIN_AV':'ENCERRAR_TESTE_ADMIN_AV'))
    return reject('Confirme a operacao no Painel AV.');
  let endpoint;
  try{
    const u=new URL(base);
    if(u.protocol!=='https:'||!u.pathname.startsWith('/webhook/'))throw Error('gateway');
    endpoint=u.origin+'/webhook/av360-admin-trial-panel-v1';
  }catch{return reject('Gateway de administracao invalido.',503);}
  const payload={
    acao:body.acao,empresa_id:body.empresa_id,
    dias:body.acao==='iniciar'?body.dias:null,
    email_login:String(body.email_login).trim().toLowerCase(),
    asaas_customer_id:body.asaas_customer_id,confirmacao:body.confirmacao,
    administrador_supabase:user.id
  };
  try{
    const resp=await fetch(endpoint,{method:'POST',headers:{
      'Content-Type':'application/json','Accept':'application/json','X-AV-Bridge-Secret':secret
    },body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(25000)});
    const data=await resp.json().catch(()=>null);
    if(!resp.ok)return reject('Falha ao executar o controle de teste no servidor (HTTP '+resp.status+').',502);
    const obj=(data&&typeof data==='object'&&data.result)?data.result:data;
    if(!obj||typeof obj!=='object')return reject('Resposta invalida do gateway de teste.',502);
    if(obj.ok!==true)return result({ok:false,error:obj.error||'Operacao nao autorizada. Confira login, empresa, Asaas e status.'},400);
    return result(obj);
  }catch{return reject('Nao foi possivel acessar a conciliacao administrativa no n8n.',502);}
}
export function onRequestGet(){return reject('Use POST com autenticacao administrativa.',405);}

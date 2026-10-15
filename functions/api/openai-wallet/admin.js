/* AV Admin SaaS -> N8N -> PostgreSQL (Cloudfy). Endpoint somente administrativo.
 * Nao importa chaves OpenAI; nunca aciona pagamentos no provedor.
 * Configure no Cloudflare: AV_OPENAI_WALLET_N8N_URL, AV_OPENAI_WALLET_BRIDGE_SECRET.
 */
const actions = new Set(['resumo','conferir_lastro','cadastrar','alocar','devolver','tarifa']);
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequestPost({request,env}) {
  const supabaseUrl=String(env.AV_SUPABASE_URL||env.SUPABASE_URL||'').replace(/\/$/,'');
  const supabaseAnon=env.AV_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  const endpoint=String(env.AV_OPENAI_WALLET_N8N_URL||'');
  const secret=String(env.AV_OPENAI_WALLET_BRIDGE_SECRET||'');
  if (!supabaseUrl || !supabaseAnon || !endpoint || !secret || !/^https:\/\/[^/]+\/webhook\//i.test(endpoint))
    return send({ok:false,erro:'Integração da carteira não configurada no Cloudflare.'},503);
  const bearer=request.headers.get('Authorization')||'';
  if (!/^Bearer\s+\S+$/i.test(bearer)) return send({ok:false,erro:'Sessão administrativa obrigatória.'},401);
  let response;
  try { response=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:supabaseAnon,Authorization:bearer},cache:'no-store'}); }
  catch { return send({ok:false,erro:'Não foi possível validar o login.'},502); }
  if (!response.ok) return send({ok:false,erro:'Sessão expirada.'},401);
  let u;try {u=await response.json();}catch {return send({ok:false,erro:'Resposta inválida da autenticação.'},502);}
  const email=String(u?.email||'').trim().toLowerCase();
  if (!u?.id || !email || email!==String(env.AV_ADMIN_EMAIL||'avrep.tech@gmail.com').trim().toLowerCase())return send({ok:false,erro:'Acesso administrativo não autorizado.'},403);
  let body;try {body=await request.json();}catch{return send({ok:false,erro:'JSON inválido.'},400);}
  if (!body || !actions.has(body.acao))return send({ok:false,erro:'Ação não permitida.'},400);
  if (JSON.stringify(body).length>5000)return send({ok:false,erro:'Conteúdo excede o limite.'},413);
  if (['alocar','devolver'].includes(body.acao) && (!Number.isSafeInteger(body.valor_centavos)||body.valor_centavos<1||body.valor_centavos>100000000))
    return send({ok:false,erro:'Valor deve estar em centavos inteiros e positivo.'},400);
  if (['alocar','devolver','cadastrar'].includes(body.acao)){
    if (!['juridico','agenda','vendas'].includes(body.crm) || typeof body.empresa_id!=='string' || body.empresa_id.length>160 || !body.empresa_id.trim())
      return send({ok:false,erro:'Identificação de empresa inválida.'},400);
  }
  let upstream;try {
    upstream=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','X-AV-Bridge-Secret':secret},body:JSON.stringify(body),cache:'no-store',redirect:'error'});
  } catch {return send({ok:false,erro:'Não foi possível comunicar com a carteira via n8n.'},502);}
  let result;try {result=await upstream.json();}catch{return send({ok:false,erro:'Gateway não retornou JSON.'},502);}
  const data=result?.result??result;
  if(!upstream.ok)return send({ok:false,erro:`Gateway indisponível (HTTP ${upstream.status}).`},502);
  if(data?.ok===false)return send(data,400);
  return send(data||{ok:false,erro:'Resposta vazia.'});
}
export const onRequestGet=()=>send({ok:false,erro:'Use POST com autenticação administrativa.'},405);


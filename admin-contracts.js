const SUPABASE_URL = 'https://eancpttjrcetmpyqwanw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vaPoYvu7bfg7okcczhyetA_L4-dKvZD';
const ALLOWED_ADMIN_EMAIL = 'avrep.tech@gmail.com';
const N8N_BASE = 'https://possessivebull-n8n.cloudfy.live/webhook/admin-av/contratos';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      'Content-Type':'application/json; charset=UTF-8',
      'Cache-Control':'no-store'
    }
  });
}

async function authorize(request) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  if (!/^Bearer\s+\S+/i.test(authorization)) return {ok:false,response:json(401,{ok:false,erro:'SESSAO_AUSENTE',mensagem:'Sessão administrativa não informada.'})};
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers:{
        'apikey':SUPABASE_PUBLISHABLE_KEY,
        'Authorization':authorization,
        'Accept':'application/json'
      }
    });
  } catch {
    return {ok:false,response:json(502,{ok:false,erro:'AUTH_INDISPONIVEL',mensagem:'Não foi possível validar a sessão administrativa.'})};
  }
  if (!response.ok) return {ok:false,response:json(401,{ok:false,erro:'SESSAO_INVALIDA',mensagem:'Sessão expirada ou inválida.'})};
  const user = await response.json();
  const email = String(user?.email || '').trim().toLowerCase();
  if (email !== ALLOWED_ADMIN_EMAIL) return {ok:false,response:json(403,{ok:false,erro:'NAO_AUTORIZADO',mensagem:'Esta conta não possui acesso ao painel administrativo.'})};
  return {ok:true,user};
}

export async function proxyAdminContract(context, action, method) {
  const auth = await authorize(context.request);
  if (!auth.ok) return auth.response;

  const adminKey = String(context.env?.ADMIN_AV_API_KEY || '').trim();
  if (!adminKey) return json(500,{ok:false,erro:'ADMIN_KEY_NAO_CONFIGURADA',mensagem:'Configure o segredo ADMIN_AV_API_KEY no Cloudflare Pages.'});

  const headers = {
    'Accept':'application/json',
    'x-admin-key':adminKey,
    'User-Agent':'AV-Tecnologias-Admin-Proxy/1.0'
  };
  const init = {method,headers,redirect:'follow'};

  if (method !== 'GET' && method !== 'HEAD') {
    const raw = await context.request.text();
    headers['Content-Type'] = 'application/json';
    init.body = raw || '{}';
  }

  let upstream;
  try {
    upstream = await fetch(`${N8N_BASE}/${action}`, init);
  } catch {
    return json(502,{ok:false,erro:'N8N_INDISPONIVEL',mensagem:'O backend administrativo está indisponível no momento.'});
  }

  const body = await upstream.text();
  return new Response(body, {
    status:upstream.status,
    headers:{
      'Content-Type':upstream.headers.get('Content-Type') || 'application/json; charset=UTF-8',
      'Cache-Control':'no-store'
    }
  });
}

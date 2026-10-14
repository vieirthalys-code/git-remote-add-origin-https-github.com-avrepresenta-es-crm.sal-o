const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

function cleanBaseUrl(value) { return String(value || '').trim().replace(/\/+$/, ''); }
function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function defaultCompanyId(env) { return String(env.BILLING_DEFAULT_EMPRESA_ID || '5').trim(); }
function companyEnv(env, key, empresaId) {
  const specific = env[`${key}_EMPRESA_${empresaId}`];
  if (specific !== undefined && String(specific).trim() !== '') return specific;
  if (String(empresaId) === defaultCompanyId(env)) return env[key];
  return undefined;
}

async function verifyAdmin(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return {ok:false,status:401,message:'Token administrativo ausente.'};
  const supabaseUrl = cleanBaseUrl(env.SUPABASE_URL);
  const supabaseKey = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) return {ok:false,status:500,message:'Backend sem configuração do Supabase.'};

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers:{'apikey':supabaseKey,'authorization':authorization}
  });
  if (!response.ok) return {ok:false,status:401,message:'Sessão administrativa inválida.'};

  const user = await response.json();
  const email = String(user?.email || '').trim().toLowerCase();
  const allowed = String(env.ADMIN_EMAIL || 'avrep.tech@gmail.com').trim().toLowerCase();
  if (!email || email !== allowed) return {ok:false,status:403,message:'Conta sem permissão para consultar faturamento.'};
  return {ok:true,user};
}

function currentMonthStartUnix() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1,0,0,0)/1000);
}
function openAiAmount(result) {
  if (!result || typeof result !== 'object') return null;
  const direct = asNumber(result?.amount?.value);
  return direct !== null ? direct : asNumber(result?.amount);
}
function openAiCurrency(result, fallback='USD') {
  return String(result?.amount?.currency || result?.currency || fallback || 'USD').trim().toUpperCase();
}

async function queryOpenAI(env, empresaId) {
  const adminKey = String(companyEnv(env,'OPENAI_ADMIN_KEY',empresaId) || '').trim();
  const headersJson = String(companyEnv(env,'OPENAI_BILLING_HEADERS_JSON',empresaId) || '').trim();
  const orgId = String(companyEnv(env,'OPENAI_ORG_ID',empresaId) || '').trim();
  const baseUrl = String(companyEnv(env,'OPENAI_BILLING_URL',empresaId) || 'https://api.openai.com/v1/organization/costs').trim();
  const accountLabel = String(companyEnv(env,'OPENAI_ACCOUNT_LABEL',empresaId) || `OpenAI · empresa ${empresaId}`).trim();
  const projectId = String(companyEnv(env,'OPENAI_PROJECT_ID',empresaId) || '').trim();
  if (!projectId) {
    return {ok:false,configured:false,provider:'OpenAI',spent:null,currency:'USD',updated_at:null,account_label:accountLabel,message:`Vincule o projeto da OpenAI configurando OPENAI_PROJECT_ID_EMPRESA_${empresaId} na Cloudflare. Sem esse vínculo, não exibiremos o gasto de toda a organização como se fosse desta empresa.`};
  }
  if (!/^proj_[A-Za-z0-9_-]+$/.test(projectId)) {
    return {ok:false,configured:false,provider:'OpenAI',spent:null,currency:'USD',updated_at:null,account_label:accountLabel,message:'OPENAI_PROJECT_ID inválido para esta empresa.'};
  }

  let headers = {'accept':'application/json'};
  if (adminKey) headers.authorization = `Bearer ${adminKey}`;
  else if (headersJson) {
    try { headers = {...headers,...JSON.parse(headersJson)}; }
    catch {
      return {ok:false,configured:true,provider:'OpenAI',spent:null,currency:'USD',updated_at:null,account_label:accountLabel,message:'Headers da OpenAI inválidos para esta empresa.'};
    }
  } else {
    return {ok:false,configured:false,provider:'OpenAI',spent:null,currency:'USD',updated_at:null,account_label:accountLabel,message:'OpenAI real ainda não configurada para esta empresa.'};
  }
  if (orgId) headers['OpenAI-Organization'] = orgId;

  let spent = 0;
  let currency = String(companyEnv(env,'OPENAI_DEFAULT_CURRENCY',empresaId) || 'USD').trim().toUpperCase();
  let nextPage = null;
  let pagesRead = 0;
  const seen = new Set();

  try {
    do {
      const url = new URL(baseUrl);
      url.searchParams.set('start_time',String(currentMonthStartUnix()));
      url.searchParams.set('group_by','project_id');
      url.searchParams.set('project_ids',projectId);
      url.searchParams.set('limit','31');
      if (nextPage) url.searchParams.set('page',nextPage);

      const response = await fetch(url.toString(),{method:'GET',headers,cf:{cacheTtl:0,cacheEverything:false}});
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch { return {ok:false,configured:true,provider:'OpenAI',spent:null,currency,updated_at:new Date().toISOString(),account_label:accountLabel,message:`OpenAI respondeu em formato não JSON (HTTP ${response.status}).`}; }

      if (!response.ok) {
        return {ok:false,configured:true,provider:'OpenAI',spent:null,currency,updated_at:new Date().toISOString(),account_label:accountLabel,message:`OpenAI: ${payload?.error?.message || payload?.message || `HTTP ${response.status}`}`};
      }

      for (const bucket of (Array.isArray(payload?.data) ? payload.data : [])) {
        for (const result of (Array.isArray(bucket?.results) ? bucket.results : [])) {
          const value = openAiAmount(result);
          // Costs must only be attributed to the matching OpenAI project.
          if (String(result?.project_id || '') !== projectId) continue;
          if (value !== null) spent += value;
          currency = openAiCurrency(result,currency);
        }
      }

      pagesRead += 1;
      const candidate = payload?.has_more && payload?.next_page ? String(payload.next_page) : null;
      if (!candidate || seen.has(candidate) || pagesRead >= 100) nextPage = null;
      else { seen.add(candidate); nextPage = candidate; }
    } while(nextPage);

    return {
      ok:true,configured:true,provider:'OpenAI',spent,currency,
      account_label:accountLabel,updated_at:new Date().toISOString(),
      message:'Gasto mensal do projeto OpenAI confirmado pela API de custos; não é saldo pré-pago.'
    };
  } catch(error) {
    return {ok:false,configured:true,provider:'OpenAI',spent:null,currency,account_label:accountLabel,updated_at:new Date().toISOString(),message:`OpenAI: ${error?.message || 'Falha ao consultar custos.'}`};
  }
}

export async function onRequestGet({request,env}) {
  const auth = await verifyAdmin(request,env);
  if (!auth.ok) return json({ok:false,message:auth.message},auth.status);

  const url = new URL(request.url);
  const empresaId = Number(url.searchParams.get('empresa_id') || 0);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return json({ok:false,message:'empresa_id inválido.'},400);

  const openai = await queryOpenAI(env,empresaId);
  return json({ok:true,empresa_id:empresaId,generated_at:new Date().toISOString(),providers:{openai}});
}

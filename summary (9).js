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
      message:'Gasto real do mês obtido diretamente da organização OpenAI configurada para esta empresa.'
    };
  } catch(error) {
    return {ok:false,configured:true,provider:'OpenAI',spent:null,currency,account_label:accountLabel,updated_at:new Date().toISOString(),message:`OpenAI: ${error?.message || 'Falha ao consultar custos.'}`};
  }
}

function validBigQueryTable(value) {
  const table = String(value || '').trim().replace(/^`|`$/g,'');
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_$-]+$/.test(table) ? table : null;
}

async function getGoogleAccessToken(env, empresaId) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(companyEnv(env,'GOOGLE_OAUTH_REFRESH_TOKEN',empresaId) || '').trim();
  if (!clientId || !clientSecret || !refreshToken) throw new Error('OAuth do Google não está completo para esta empresa.');

  const body = new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'});
  const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  const payload = await response.json().catch(()=>({}));
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || payload?.error || `Falha OAuth Google (HTTP ${response.status}).`);
  return payload.access_token;
}

function bigQueryRowsToObjects(payload) {
  const fields = Array.isArray(payload?.schema?.fields) ? payload.schema.fields : [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows.map(row => {
    const out = {};
    const values = Array.isArray(row?.f) ? row.f : [];
    fields.forEach((field,i)=>{ out[field.name] = values[i]?.v ?? null; });
    return out;
  });
}

async function runBigQuery(env, empresaId, accessToken, query) {
  const projectId = String(companyEnv(env,'GOOGLE_CLOUD_PROJECT_ID',empresaId) || '').trim();
  const location = String(companyEnv(env,'GOOGLE_BIGQUERY_LOCATION',empresaId) || '').trim();
  if (!projectId) throw new Error('Projeto Google Cloud não configurado para esta empresa.');

  const body = {query,useLegacySql:false,timeoutMs:20000};
  if (location) body.location = location;

  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,{
    method:'POST',
    headers:{'authorization':`Bearer ${accessToken}`,'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify(body),
    cf:{cacheTtl:0,cacheEverything:false}
  });
  let payload = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(payload?.error?.message || `BigQuery HTTP ${response.status}`);

  if (!payload?.jobComplete && payload?.jobReference?.jobId) {
    const u = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(payload.jobReference.jobId)}`);
    u.searchParams.set('timeoutMs','20000');
    const loc = payload?.jobReference?.location || location;
    if (loc) u.searchParams.set('location',loc);
    const poll = await fetch(u.toString(),{headers:{'authorization':`Bearer ${accessToken}`,'accept':'application/json'},cf:{cacheTtl:0,cacheEverything:false}});
    payload = await poll.json().catch(()=>({}));
    if (!poll.ok) throw new Error(payload?.error?.message || `BigQuery HTTP ${poll.status}`);
  }
  return payload;
}

async function queryGoogle(env, empresaId) {
  const projectId = String(companyEnv(env,'GOOGLE_CLOUD_PROJECT_ID',empresaId) || '').trim();
  const table = validBigQueryTable(companyEnv(env,'GOOGLE_BILLING_TABLE',empresaId));
  const refreshToken = String(companyEnv(env,'GOOGLE_OAUTH_REFRESH_TOKEN',empresaId) || '').trim();
  const accountLabel = projectId || `Google Cloud · empresa ${empresaId}`;

  if (!projectId || !table || !refreshToken) {
    const missing = [];
    if (!refreshToken) missing.push('OAuth');
    if (!projectId) missing.push('projeto');
    if (!table) missing.push('tabela de faturamento');
    return {ok:false,configured:false,provider:'Google Cloud',spent:null,currency:'USD',updated_at:null,account_label:accountLabel,message:`Google real ainda não configurado para esta empresa: ${missing.join(', ')}.`};
  }

  try {
    const accessToken = await getGoogleAccessToken(env,empresaId);
    const query = `
      SELECT
        COALESCE(SUM(cost),0) + COALESCE(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c),0)),0) AS spent,
        ANY_VALUE(currency) AS currency
      FROM \`${table}\`
      WHERE usage_start_time >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
    `;
    const payload = await runBigQuery(env,empresaId,accessToken,query);
    const first = bigQueryRowsToObjects(payload)[0] || {};
    const spent = asNumber(first.spent) ?? 0;
    const currency = String(first.currency || companyEnv(env,'GOOGLE_DEFAULT_CURRENCY',empresaId) || 'USD').trim().toUpperCase();
    return {ok:true,configured:true,provider:'Google Cloud',spent,currency,account_label:projectId,updated_at:new Date().toISOString(),message:'Gasto real do mês obtido do Cloud Billing Export no BigQuery desta empresa.'};
  } catch(error) {
    return {ok:false,configured:true,provider:'Google Cloud',spent:null,currency:'USD',account_label:accountLabel,updated_at:new Date().toISOString(),message:`Google Cloud: ${error?.message || 'Falha ao consultar faturamento.'}`};
  }
}

export async function onRequestGet({request,env}) {
  const auth = await verifyAdmin(request,env);
  if (!auth.ok) return json({ok:false,message:auth.message},auth.status);

  const url = new URL(request.url);
  const empresaId = Number(url.searchParams.get('empresa_id') || 0);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return json({ok:false,message:'empresa_id inválido.'},400);

  const [openai,google] = await Promise.all([queryOpenAI(env,empresaId),queryGoogle(env,empresaId)]);
  return json({ok:true,empresa_id:empresaId,generated_at:new Date().toISOString(),providers:{openai,google}});
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getByPath(obj, path) {
  const p = String(path || '').trim();
  if (!p) return null;
  return p.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return null;
    const m = key.match(/^(.+?)\[(\d+)\]$/);
    if (m) {
      const arr = acc[m[1]];
      return Array.isArray(arr) ? arr[Number(m[2])] : null;
    }
    return acc[key];
  }, obj);
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function verifyAdmin(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return { ok: false, status: 401, message: 'Token administrativo ausente.' };
  }

  const supabaseUrl = cleanBaseUrl(env.SUPABASE_URL);
  const supabaseKey = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, status: 500, message: 'Backend sem configuração do Supabase.' };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      'apikey': supabaseKey,
      'authorization': authorization
    }
  });

  if (!response.ok) {
    return { ok: false, status: 401, message: 'Sessão administrativa inválida.' };
  }

  const user = await response.json();
  const email = String(user?.email || '').trim().toLowerCase();
  const allowed = String(env.ADMIN_EMAIL || 'avrep.tech@gmail.com').trim().toLowerCase();

  if (!email || email !== allowed) {
    return { ok: false, status: 403, message: 'Conta sem permissão para consultar faturamento.' };
  }

  return { ok: true, user };
}

function providerConfig(env, prefix) {
  return {
    url: String(env[`${prefix}_BILLING_URL`] || '').trim(),
    headersJson: String(env[`${prefix}_BILLING_HEADERS_JSON`] || '').trim(),
    balancePath: String(env[`${prefix}_BALANCE_PATH`] || '').trim(),
    spentPath: String(env[`${prefix}_SPENT_PATH`] || '').trim(),
    limitPath: String(env[`${prefix}_LIMIT_PATH`] || '').trim(),
    currencyPath: String(env[`${prefix}_CURRENCY_PATH`] || '').trim(),
    accountPath: String(env[`${prefix}_ACCOUNT_LABEL_PATH`] || '').trim(),
    defaultCurrency: String(env[`${prefix}_DEFAULT_CURRENCY`] || 'USD').trim(),
    staticLimit: asNumber(env[`${prefix}_STATIC_LIMIT`]),
    calculateBalance: String(env[`${prefix}_CALCULATE_BALANCE`] || '').toLowerCase() === 'true'
  };
}

function parseHeaders(headersJson) {
  let headers = { 'accept': 'application/json' };
  if (!headersJson) return headers;
  headers = { ...headers, ...JSON.parse(headersJson) };
  return headers;
}

function currentMonthStartUnix() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0) / 1000);
}

function openAiAmount(result) {
  if (!result || typeof result !== 'object') return null;
  const direct = asNumber(result?.amount?.value);
  if (direct !== null) return direct;
  return asNumber(result?.amount);
}

function openAiCurrency(result, fallback = 'USD') {
  const currency = result?.amount?.currency || result?.currency || fallback;
  return String(currency || 'USD').trim().toUpperCase();
}

async function queryOpenAI(env) {
  const cfg = providerConfig(env, 'OPENAI');

  if (!cfg.headersJson) {
    return {
      ok: false,
      configured: false,
      provider: 'OpenAI',
      balance: null,
      spent: null,
      limit: cfg.staticLimit,
      currency: cfg.defaultCurrency || 'USD',
      updated_at: null,
      message: 'Chave administrativa da OpenAI ainda não configurada no Cloudflare.'
    };
  }

  let headers;
  try {
    headers = parseHeaders(cfg.headersJson);
  } catch {
    return {
      ok: false,
      configured: true,
      provider: 'OpenAI',
      balance: null,
      spent: null,
      limit: cfg.staticLimit,
      currency: cfg.defaultCurrency || 'USD',
      updated_at: null,
      message: 'Configuração de headers inválida para OpenAI.'
    };
  }

  const baseUrl = cfg.url || 'https://api.openai.com/v1/organization/costs';
  const startTime = currentMonthStartUnix();
  let nextPage = null;
  let spent = 0;
  let currency = String(cfg.defaultCurrency || 'USD').toUpperCase();
  let pagesRead = 0;
  const seenPages = new Set();

  try {
    do {
      const url = new URL(baseUrl);
      url.searchParams.set('start_time', String(startTime));
      if (nextPage) url.searchParams.set('page', nextPage);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      const raw = await response.text();
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch {
        return {
          ok: false,
          configured: true,
          provider: 'OpenAI',
          balance: null,
          spent: null,
          limit: cfg.staticLimit,
          currency,
          updated_at: new Date().toISOString(),
          message: `OpenAI respondeu em formato não JSON (HTTP ${response.status}).`
        };
      }

      if (!response.ok) {
        const providerMessage = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        return {
          ok: false,
          configured: true,
          provider: 'OpenAI',
          balance: null,
          spent: null,
          limit: cfg.staticLimit,
          currency,
          updated_at: new Date().toISOString(),
          message: `OpenAI: ${providerMessage}`
        };
      }

      const buckets = Array.isArray(payload?.data) ? payload.data : [];
      for (const bucket of buckets) {
        const results = Array.isArray(bucket?.results) ? bucket.results : [];
        for (const result of results) {
          const value = openAiAmount(result);
          if (value !== null) spent += value;
          currency = openAiCurrency(result, currency);
        }
      }

      pagesRead += 1;
      const candidate = payload?.has_more && payload?.next_page
        ? String(payload.next_page)
        : null;

      if (!candidate || seenPages.has(candidate) || pagesRead >= 100) {
        nextPage = null;
      } else {
        seenPages.add(candidate);
        nextPage = candidate;
      }
    } while (nextPage);

    let balance = null;
    const limit = cfg.staticLimit;
    if (cfg.calculateBalance && limit !== null) {
      balance = Math.max(limit - spent, 0);
    }

    return {
      ok: true,
      configured: true,
      provider: 'OpenAI',
      balance,
      spent,
      limit,
      currency,
      account_label: 'Organização OpenAI',
      updated_at: new Date().toISOString(),
      message: balance === null
        ? 'Gasto real do mês atual obtido pela API oficial de Costs. O saldo/crédito restante não é retornado por este endpoint.'
        : 'Gasto real do mês atual obtido pela API oficial de Costs. O saldo exibido é calculado a partir do limite configurado.'
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      provider: 'OpenAI',
      balance: null,
      spent: null,
      limit: cfg.staticLimit,
      currency,
      updated_at: new Date().toISOString(),
      message: `OpenAI: ${error?.message || 'Falha ao consultar custos.'}`
    };
  }
}

async function getGoogleAccessToken(env) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth do Google ainda não está completo no Cloudflare.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `Falha OAuth Google (HTTP ${response.status}).`);
  }

  return payload.access_token;
}

function validBigQueryTable(value) {
  const table = String(value || '').trim().replace(/^`|`$/g, '');
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_$-]+$/.test(table)) return null;
  return table;
}

function bigQueryRowsToObjects(payload) {
  const fields = Array.isArray(payload?.schema?.fields) ? payload.schema.fields : [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows.map(row => {
    const out = {};
    const values = Array.isArray(row?.f) ? row.f : [];
    fields.forEach((field, i) => { out[field.name] = values[i]?.v ?? null; });
    return out;
  });
}

async function runBigQuery(env, accessToken, query) {
  const projectId = String(env.GOOGLE_CLOUD_PROJECT_ID || '').trim();
  const location = String(env.GOOGLE_BIGQUERY_LOCATION || '').trim();
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT_ID não configurado.');

  const body = { query, useLegacySql: false, timeoutMs: 20000 };
  if (location) body.location = location;

  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify(body),
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  let payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload?.error?.message || `BigQuery HTTP ${response.status}`;
    throw new Error(msg);
  }

  if (!payload?.jobComplete && payload?.jobReference?.jobId) {
    const u = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(payload.jobReference.jobId)}`);
    u.searchParams.set('timeoutMs', '20000');
    const jobLocation = payload?.jobReference?.location || location;
    if (jobLocation) u.searchParams.set('location', jobLocation);

    const poll = await fetch(u.toString(), {
      headers: {
        'authorization': `Bearer ${accessToken}`,
        'accept': 'application/json'
      },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    payload = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(payload?.error?.message || `BigQuery HTTP ${poll.status}`);
  }

  return payload;
}

async function queryGoogle(env) {
  const projectId = String(env.GOOGLE_CLOUD_PROJECT_ID || '').trim();
  const table = validBigQueryTable(env.GOOGLE_BILLING_TABLE);
  const hasOAuth = Boolean(
    String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim() &&
    String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim() &&
    String(env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim()
  );

  if (!projectId || !table || !hasOAuth) {
    const missing = [];
    if (!hasOAuth) missing.push('OAuth/refresh token');
    if (!projectId) missing.push('GOOGLE_CLOUD_PROJECT_ID');
    if (!table) missing.push('GOOGLE_BILLING_TABLE');
    return {
      ok: false,
      configured: false,
      provider: 'Google Cloud',
      balance: null,
      spent: null,
      limit: null,
      currency: 'USD',
      updated_at: null,
      message: `Conector Google aguardando: ${missing.join(', ')}.`
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(env);
    const query = `
      SELECT
        COALESCE(SUM(cost), 0) + COALESCE(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)), 0) AS spent,
        ANY_VALUE(currency) AS currency
      FROM \`${table}\`
      WHERE usage_start_time >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
    `;

    const payload = await runBigQuery(env, accessToken, query);
    const rows = bigQueryRowsToObjects(payload);
    const first = rows[0] || {};
    const spent = asNumber(first.spent) ?? 0;
    const currency = String(first.currency || env.GOOGLE_DEFAULT_CURRENCY || 'USD').trim().toUpperCase();

    return {
      ok: true,
      configured: true,
      provider: 'Google Cloud',
      balance: null,
      spent,
      limit: null,
      currency,
      account_label: projectId,
      updated_at: new Date().toISOString(),
      message: 'Gasto líquido do mês atual obtido do Cloud Billing Export no BigQuery. O saldo/crédito promocional restante não é calculado por esta consulta.'
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      provider: 'Google Cloud',
      balance: null,
      spent: null,
      limit: null,
      currency: String(env.GOOGLE_DEFAULT_CURRENCY || 'USD').trim().toUpperCase(),
      updated_at: new Date().toISOString(),
      message: `Google Cloud: ${error?.message || 'Falha ao consultar faturamento.'}`
    };
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(request, env);
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);

  const [openai, google] = await Promise.all([
    queryOpenAI(env),
    queryGoogle(env)
  ]);

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    providers: { openai, google }
  });
}

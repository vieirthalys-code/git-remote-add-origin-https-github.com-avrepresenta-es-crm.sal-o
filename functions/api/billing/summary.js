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

async function queryProvider(env, prefix, label) {
  const cfg = providerConfig(env, prefix);

  if (!cfg.url) {
    return {
      ok: false,
      configured: false,
      provider: label,
      balance: null,
      spent: null,
      limit: cfg.staticLimit,
      currency: cfg.defaultCurrency,
      updated_at: null,
      message: 'Conector de faturamento ainda não configurado no Cloudflare.'
    };
  }

  let headers;
  try {
    headers = parseHeaders(cfg.headersJson);
  } catch {
    return {
      ok: false,
      configured: true,
      provider: label,
      balance: null,
      spent: null,
      limit: cfg.staticLimit,
      currency: cfg.defaultCurrency,
      updated_at: null,
      message: `Configuração de headers inválida para ${label}.`
    };
  }

  try {
    const response = await fetch(cfg.url, {
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
        provider: label,
        balance: null,
        spent: null,
        limit: cfg.staticLimit,
        currency: cfg.defaultCurrency,
        updated_at: new Date().toISOString(),
        message: `${label} respondeu em formato não JSON (HTTP ${response.status}).`
      };
    }

    if (!response.ok) {
      const providerMessage = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      return {
        ok: false,
        configured: true,
        provider: label,
        balance: null,
        spent: null,
        limit: cfg.staticLimit,
        currency: cfg.defaultCurrency,
        updated_at: new Date().toISOString(),
        message: `${label}: ${providerMessage}`
      };
    }

    let balance = asNumber(getByPath(payload, cfg.balancePath));
    const spent = asNumber(getByPath(payload, cfg.spentPath));
    const mappedLimit = asNumber(getByPath(payload, cfg.limitPath));
    const limit = mappedLimit ?? cfg.staticLimit;
    const currency = String(getByPath(payload, cfg.currencyPath) || cfg.defaultCurrency || 'USD');
    const accountLabel = getByPath(payload, cfg.accountPath);

    if (balance === null && cfg.calculateBalance && limit !== null && spent !== null) {
      balance = Math.max(limit - spent, 0);
    }

    const hasFinancialValue = [balance, spent, limit].some(v => v !== null);

    return {
      ok: hasFinancialValue,
      configured: true,
      provider: label,
      balance,
      spent,
      limit,
      currency,
      account_label: accountLabel ? String(accountLabel) : undefined,
      updated_at: new Date().toISOString(),
      message: hasFinancialValue
        ? 'Dados obtidos da conta de faturamento.'
        : 'A conexão respondeu, mas os caminhos de saldo/gasto/limite ainda precisam ser mapeados.'
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      provider: label,
      balance: null,
      spent: null,
      limit: cfg.staticLimit,
      currency: cfg.defaultCurrency,
      updated_at: new Date().toISOString(),
      message: `${label}: ${error?.message || 'Falha ao consultar faturamento.'}`
    };
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdmin(request, env);
  if (!auth.ok) return json({ ok: false, message: auth.message }, auth.status);

  const [openai, google] = await Promise.all([
    queryOpenAI(env),
    queryProvider(env, 'GOOGLE', 'Google Cloud')
  ]);

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    providers: { openai, google }
  });
}

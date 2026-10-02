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

  let headers = { 'accept': 'application/json' };
  if (cfg.headersJson) {
    try {
      headers = { ...headers, ...JSON.parse(cfg.headersJson) };
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
    queryProvider(env, 'OPENAI', 'OpenAI'),
    queryProvider(env, 'GOOGLE', 'Google Cloud')
  ]);

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    providers: { openai, google }
  });
}

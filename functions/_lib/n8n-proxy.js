// Proxy de mesma origem para os webhooks administrativos do n8n (CRM Jurídico).
// Objetivo: blindar o painel contra as instabilidades do n8n sem mudar o
// comportamento. O retry no servidor acontece APENAS para leituras
// idempotentes — nunca para escritas (ex.: saldo), para não haver risco de
// duplicar nenhuma operação. Preserva status e corpo exatamente como o n8n.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Somente leituras seguras de repetir (não alteram dados).
const RETRY_SAFE = new Set([
  'empresas',
  'listar',
  'crm-dados',
  'historico',
  'precos/listar',
  'agenda-prompts/listar',
]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchRetry(url, init, retries, baseDelay = 500) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      // Repete apenas em instabilidade do servidor (5xx) ou excesso (429).
      if ((response.status >= 500 || response.status === 429) && attempt < retries) {
        await sleep(baseDelay * (attempt + 1));
        continue;
      }
      return response;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelay * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// baseUrl: raiz do webhook n8n (sem barra no fim). O subcaminho vem da rota.
export async function proxyN8n(context, baseUrl) {
  const segs = context.params && context.params.path;
  const subpath = Array.isArray(segs) ? segs.join('/') : String(segs || '');
  if (!subpath) {
    return json(404, { ok: false, erro: 'ROTA_AUSENTE', mensagem: 'Rota administrativa não informada.' });
  }

  const retries = RETRY_SAFE.has(subpath) ? 2 : 0;

  const raw = await context.request.text();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'AV-Tecnologias-Admin-Proxy/1.0',
  };
  // O IA Admin envia o token no cabeçalho Authorization; repassamos quando houver.
  const auth = context.request.headers.get('Authorization');
  if (auth) headers['Authorization'] = auth;

  let upstream;
  try {
    upstream = await fetchRetry(`${baseUrl}/${subpath}`, {
      method: 'POST',
      headers,
      body: raw || '{}',
      redirect: 'follow',
    }, retries);
  } catch {
    return json(502, {
      ok: false,
      erro: 'N8N_INDISPONIVEL',
      mensagem: 'O servidor administrativo está indisponível no momento. Tente novamente.',
    });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

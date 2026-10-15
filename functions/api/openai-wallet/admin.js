/*
 * AV Admin SaaS -> Cloudflare Pages -> n8n Cloudfy -> PostgreSQL
 * Carteira OpenAI: endpoint exclusivamente administrativo.
 * Nao importa chaves da OpenAI nem executa pagamentos no provedor.
 * Secrets no Cloudflare (Production):
 *   AV_OPENAI_WALLET_N8N_URL
 *   AV_OPENAI_WALLET_BRIDGE_SECRET
 * Autenticacao Supabase ja usada pelo Admin AV:
 *   AV_SUPABASE_URL, AV_SUPABASE_PUBLISHABLE_KEY, AV_ADMIN_EMAIL
 */
const ACTIONS = new Set([
  'resumo',
  'conferir_lastro',
  'cadastrar',
  'alocar',
  'devolver',
  'tarifa',
]);

function send(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function logFailure(reference, stage, details = {}) {
  // Nunca registrar senhas, tokens, headers de autenticacao ou corpo da requisicao.
  console.error('AV_OPENAI_WALLET_FAILURE', {
    referencia: reference,
    etapa: stage,
    ...details,
  });
}

function safeErrorMessage(error) {
  // Somente informacoes tecnicas curtas nos logs privados da Cloudflare.
  return String(error?.message || error?.name || 'Erro desconhecido')
    .replace(/(sk-[A-Za-z0-9_-]+)/g, '[REDACTED]')
    .slice(0, 220);
}

export async function onRequestPost({ request, env }) {
  const reference = crypto.randomUUID().slice(0, 8);
  const supabaseUrl = String(env.AV_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseAnon = String(env.AV_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '');
  const endpoint = String(env.AV_OPENAI_WALLET_N8N_URL || '').trim();
  const secret = String(env.AV_OPENAI_WALLET_BRIDGE_SECRET || '');

  let target;
  try {
    target = new URL(endpoint);
  } catch {
    return send({ ok: false, erro: 'URL do gateway da carteira inválida no Cloudflare.', codigo: 'WALLET_CONFIG_URL' }, 503);
  }

  if (
    !supabaseUrl || !supabaseAnon || !secret ||
    target.protocol !== 'https:' ||
    !target.hostname ||
    !target.pathname.startsWith('/webhook/') ||
    target.username || target.password || target.hash
  ) {
    return send({
      ok: false,
      erro: 'Integração da carteira não configurada corretamente no Cloudflare.',
      codigo: 'WALLET_CONFIG',
    }, 503);
  }

  // A chamada n8n so pode sair para o servidor Cloudfy esperado.
  // Reduz risco de enviar o segredo a um destino arbitrario por engano.
  if (target.hostname !== 'possessivebull-n8n.cloudfy.live') {
    return send({
      ok: false,
      erro: 'O endereço do gateway não corresponde ao servidor n8n autorizado.',
      codigo: 'WALLET_HOST_UNEXPECTED',
    }, 503);
  }

  const bearer = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(bearer)) {
    return send({ ok: false, erro: 'Sessão administrativa obrigatória.' }, 401);
  }

  let authResponse;
  try {
    authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnon, Authorization: bearer },
      cache: 'no-store',
    });
  } catch (error) {
    logFailure(reference, 'supabase_fetch', { mensagem: safeErrorMessage(error) });
    return send({
      ok: false,
      erro: 'Não foi possível validar o login.',
      codigo: 'AUTH_FETCH_FAILED',
      referencia: reference,
    }, 502);
  }

  if (!authResponse.ok) {
    return send({ ok: false, erro: 'Sessão expirada.' }, 401);
  }

  let user;
  try {
    user = await authResponse.json();
  } catch (error) {
    logFailure(reference, 'supabase_json', { mensagem: safeErrorMessage(error) });
    return send({ ok: false, erro: 'Resposta inválida da autenticação.' }, 502);
  }

  const email = String(user?.email || '').trim().toLowerCase();
  const adminEmail = String(env.AV_ADMIN_EMAIL || 'avrep.tech@gmail.com').trim().toLowerCase();
  if (!user?.id || !email || email !== adminEmail) {
    return send({ ok: false, erro: 'Acesso administrativo não autorizado.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return send({ ok: false, erro: 'JSON inválido.' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.acao)) {
    return send({ ok: false, erro: 'Ação não permitida.' }, 400);
  }
  if (JSON.stringify(body).length > 5000) {
    return send({ ok: false, erro: 'Conteúdo excede o limite.' }, 413);
  }
  if (
    ['alocar', 'devolver'].includes(body.acao) &&
    (!Number.isSafeInteger(body.valor_centavos) || body.valor_centavos < 1 || body.valor_centavos > 100000000)
  ) {
    return send({ ok: false, erro: 'Valor deve estar em centavos inteiros e positivo.' }, 400);
  }
  if (['alocar', 'devolver', 'cadastrar'].includes(body.acao)) {
    if (
      !['juridico', 'agenda', 'vendas'].includes(body.crm) ||
      typeof body.empresa_id !== 'string' ||
      body.empresa_id.length > 160 || !body.empresa_id.trim()
    ) {
      return send({ ok: false, erro: 'Identificação de empresa inválida.' }, 400);
    }
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AV-Bridge-Secret': secret,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      // Nao repassar o segredo automaticamente a outro dominio em um redirect.
      // Em vez de lancar erro silencioso, identificamos qualquer redirect pelo status.
      redirect: 'manual',
    });
  } catch (error) {
    logFailure(reference, 'n8n_fetch', {
      nome: String(error?.name || 'Error'),
      mensagem: safeErrorMessage(error),
      host: target.hostname,
    });
    return send({
      ok: false,
      erro: 'Falha de conexão entre Cloudflare e n8n. Consulte os logs da função.',
      codigo: 'N8N_FETCH_FAILED',
      referencia: reference,
    }, 502);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    let redirectHost = '';
    try {
      redirectHost = new URL(upstream.headers.get('location') || '', target).hostname;
    } catch { /* sem host */ }
    logFailure(reference, 'n8n_redirect', {
      http: upstream.status,
      destino_host: redirectHost,
    });
    return send({
      ok: false,
      erro: `O gateway n8n redirecionou a requisição (HTTP ${upstream.status}).`,
      codigo: 'N8N_REDIRECT',
      referencia: reference,
    }, 502);
  }

  if (!upstream.ok) {
    logFailure(reference, 'n8n_http', {
      http: upstream.status,
      tipo: upstream.headers.get('content-type') || '',
    });
    if (upstream.status === 401 || upstream.status === 403) {
      return send({
        ok: false,
        erro: `O n8n rejeitou a autenticação da Cloudflare (HTTP ${upstream.status}). Verifique a senha do Secret.`,
        codigo: 'N8N_AUTH_REJECTED',
        referencia: reference,
      }, 502);
    }
    return send({
      ok: false,
      erro: `Gateway n8n retornou HTTP ${upstream.status}.`,
      codigo: 'N8N_HTTP_ERROR',
      referencia: reference,
    }, 502);
  }

  let result;
  try {
    result = await upstream.json();
  } catch (error) {
    logFailure(reference, 'n8n_json', {
      tipo: upstream.headers.get('content-type') || '',
      mensagem: safeErrorMessage(error),
    });
    return send({
      ok: false,
      erro: 'O gateway n8n respondeu, mas não retornou JSON válido.',
      codigo: 'N8N_INVALID_JSON',
      referencia: reference,
    }, 502);
  }

  const data = result?.result ?? result;
  if (data?.ok === false) return send(data, 400);
  return send(data || { ok: false, erro: 'Resposta vazia.' });
}

export const onRequestGet = () => send({
  ok: false,
  erro: 'Use POST com autenticação administrativa.',
}, 405);

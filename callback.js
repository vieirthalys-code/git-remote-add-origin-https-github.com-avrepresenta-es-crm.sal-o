function html(body, status = 200) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google OAuth</title><style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#111;padding:32px}.card{max-width:760px;margin:auto;background:white;border:1px solid #ddd;border-radius:18px;padding:28px}code,textarea{font-family:ui-monospace,monospace}textarea{width:100%;min-height:110px;padding:12px;border-radius:10px;border:1px solid #bbb}button{padding:10px 16px;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer}.warn{color:#a33}</style></head><body><div class="card">${body}</div></body></html>`, {status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function verifyState(state, secret) {
  const dot = state.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  const ts = Number(payload.split(':')[0]);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now()/1000) - ts) > 900) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const expected = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64url(new Uint8Array(expected)) === signature;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return html(`<h1>Autorização cancelada</h1><p class="warn">${error}</p>`, 400);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const stateSecret = String(env.GOOGLE_OAUTH_STATE_SECRET || '').trim();
  if (!code || !stateSecret || !(await verifyState(state, stateSecret))) {
    return html('<h1>Falha de segurança</h1><p>Estado OAuth ausente, inválido ou expirado.</p>', 400);
  }

  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = String(env.GOOGLE_OAUTH_REDIRECT_URI || `${url.origin}/api/google/oauth/callback`).trim();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return html(`<h1>Falha ao trocar o código</h1><p class="warn">${payload?.error_description || payload?.error || `HTTP ${response.status}`}</p>`, 400);
  }

  const refreshToken = payload?.refresh_token;
  if (!refreshToken) {
    return html('<h1>Refresh token não retornado</h1><p>Abra novamente <code>/api/google/oauth/start</code> e autorize com consentimento.</p>', 400);
  }

  const escaped = String(refreshToken).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return html(`<h1>Google conectado</h1><p>Copie o valor abaixo e salve no Cloudflare como segredo <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>. Não envie ao GitHub nem ao chat.</p><textarea id="t" readonly>${escaped}</textarea><p><button onclick="navigator.clipboard.writeText(document.getElementById('t').value)">Copiar refresh token</button></p><p>Depois de salvar, feche esta página.</p>`);
}

const textResponse = (message,status=500) => new Response(message,{status,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});

function base64url(bytes) {
  let binary='';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
async function signState(payload,secret) {
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(payload));
  return `${payload}.${base64url(new Uint8Array(sig))}`;
}

export async function onRequestGet({request,env}) {
  const url = new URL(request.url);
  const empresaId = Number(url.searchParams.get('empresa_id') || 0);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return textResponse('empresa_id inválido.',400);

  const clientId=String(env.GOOGLE_OAUTH_CLIENT_ID||'').trim();
  const clientSecret=String(env.GOOGLE_OAUTH_CLIENT_SECRET||'').trim();
  const stateSecret=String(env.GOOGLE_OAUTH_STATE_SECRET||'').trim();
  if (!clientId || !clientSecret || !stateSecret) return textResponse('OAuth Google incompleto no Cloudflare.');

  const origin=url.origin;
  const redirectUri=String(env.GOOGLE_OAUTH_REDIRECT_URI||`${origin}/api/google/oauth/callback`).trim();
  const payload=`${Math.floor(Date.now()/1000)}:${empresaId}:${crypto.randomUUID()}`;
  const state=await signState(payload,stateSecret);

  const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id',clientId);
  auth.searchParams.set('redirect_uri',redirectUri);
  auth.searchParams.set('response_type','code');
  auth.searchParams.set('scope','https://www.googleapis.com/auth/cloud-platform');
  auth.searchParams.set('access_type','offline');
  auth.searchParams.set('prompt','consent');
  auth.searchParams.set('include_granted_scopes','true');
  auth.searchParams.set('state',state);
  return Response.redirect(auth.toString(),302);
}

export async function onRequestGet(context) {
  const key = String(context.env?.ADMIN_AV_API_KEY || '').trim();
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return new Response(JSON.stringify({
    ok: true,
    existe: Boolean(key),
    tamanho: key.length,
    hash_prefixo: hex.slice(0, 12)
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

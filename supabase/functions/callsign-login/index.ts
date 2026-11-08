const project = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const origins = (Deno.env.get('PORTAL_ORIGINS') ?? 'https://anastasieste.github.io').split(',').map(origin => origin.trim());
const handlePattern = /^[a-z0-9][a-z0-9._-]{1,31}$/;

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status, body = {}) => Response.json(body, { status, headers });
  if (!origins.includes(origin)) return reply(403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405);

  let input;
  try {
    const text = await request.text();
    if (text.length > 1024) return reply(413);
    input = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const callsign = typeof input?.callsign === 'string' ? input.callsign.trim().toLowerCase() : '';
  const password = input?.password;
  if (!handlePattern.test(callsign) || typeof password !== 'string' || !password
      || new TextEncoder().encode(password).length > 72) return reply(400);

  try {
    const lookup = await fetch(project + '/rest/v1/rpc/reserve_callsign_login', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: callsign }),
      signal: AbortSignal.timeout(8000),
    });
    if (!lookup.ok) return reply(503);
    const [match] = await lookup.json();
    if (!match?.allowed) return reply(429);

    // Los callsigns inexistentes reciben el mismo error que una contraseña incorrecta.
    const email = match.email ?? 'no-account-' + crypto.randomUUID() + '@invalid.example';
    const auth = await fetch(project + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    });
    if (auth.status === 429) return reply(429);
    if (!auth.ok || !match.email) return reply(auth.status >= 500 ? 503 : 401);
    const { access_token, refresh_token, expires_at, expires_in } = await auth.json();
    return access_token && refresh_token ? reply(200, { access_token, refresh_token, expires_at, expires_in }) : reply(503);
  } catch {
    return reply(503);
  }
});

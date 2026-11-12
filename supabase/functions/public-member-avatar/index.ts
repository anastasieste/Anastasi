const project = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const auth = { apikey: service, Authorization: `Bearer ${service}` };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
const objectPath = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/avatar$/;
const empty = (status: number) => new Response(null, { status, headers });

Deno.serve(async request => {
  if (request.method !== 'GET') return empty(405);
  const query = new URL(request.url).searchParams;
  const squad = query.get('squad');
  const callsign = query.get('callsign');
  if (!squad || !/^[A-Z0-9]{3,24}$/.test(squad) || !callsign || !/^[A-Z0-9][A-Z0-9._-]{1,31}$/i.test(callsign)) return empty(404);

  try {
    const lookup = await fetch(`${project}/rest/v1/rpc/portal_public_avatar`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ squad_code: squad, member_callsign: callsign }),
    });
    if (!lookup.ok) return empty(502);
    const name = await lookup.json();
    if (typeof name !== 'string' || !objectPath.test(name)) return empty(404);

    const picture = await fetch(`${project}/storage/v1/object/authenticated/member-avatars/${name}`, { headers: auth });
    const type = picture.headers.get('Content-Type')?.split(';')[0].toLowerCase();
    if (!picture.ok || !picture.body || !type || !supported.has(type)) {
      await picture.body?.cancel();
      return empty(picture.status >= 500 ? 502 : 404);
    }
    return new Response(picture.body, { headers: { ...headers, 'Content-Type': type } });
  } catch {
    return empty(502);
  }
});

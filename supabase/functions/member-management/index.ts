const project = Deno.env.get('SUPABASE_URL');
const publishable = Deno.env.get('SUPABASE_ANON_KEY');
const relay = Deno.env.get('PORTAL_MANAGEMENT_URL');
const secret = Deno.env.get('PORTAL_MANAGEMENT_SECRET');
const sheetId = Deno.env.get('PORTAL_MANAGEMENT_SHEET_ID');
const origin = 'https://anastasieste.github.io';

Deno.serve(async request => {
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const reply = (status, body = {}) => Response.json(body, { status, headers });
  if (request.headers.get('Origin') !== origin) return reply(403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401);
  if (!sheetId || !/^[\w-]{20,120}$/.test(sheetId) || !secret
    || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(relay ?? '')) {
    return reply(503, { code: 'sheet_not_configured' });
  }
  try {
    const text = await request.text();
    if (text.length > 256) return reply(413);
    const { action } = JSON.parse(text);
    if (!['sync', 'read', 'open'].includes(action)) return reply(400);
    const response = await fetch(project + '/rest/v1/rpc/portal_management_snapshot', {
      method: 'POST',
      headers: { apikey: publishable, Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return reply(response.status === 401 ? 401 : response.status === 403 ? 403 : 503);
    const snapshot = await response.json();
    const sheet_url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit';
    if (action === 'open') return reply(200, { sheet_url });
    const result = await fetch(relay, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, action, ...(action === 'sync' ? { snapshot } : {}) }),
      signal: AbortSignal.timeout(22000),
    });
    const data = result.ok ? await result.json() : null;
    if (data?.ok !== true) return reply(503, { code: 'sheet_unavailable' });
    if (action === 'sync') return reply(200, { sheet_url, count: data.result.count });
    const roles = new Map(snapshot.roles.map(role => [role.label, role.code]));
    const members = new Map(snapshot.members.map(member => [member.id, member]));
    if (!Array.isArray(data.result) || data.result.length > 100) return reply(400, { code: 'too_many_changes' });
    const changes = data.result.map(({ role_label, ...change }) => {
      const member = members.get(change.id);
      return {
        ...change,
        current_callsign: member?.callsign,
        role: role_label ? roles.get(role_label) ?? 'invalid' : '',
        role_label,
      };
    });
    return reply(200, { sheet_url, changes });
  } catch {
    return reply(503, { code: 'sheet_unavailable' });
  }
});

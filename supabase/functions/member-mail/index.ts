const project = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const jobSecret = Deno.env.get('PORTAL_MAIL_JOB_SECRET');
const relayUrl = Deno.env.get('PORTAL_MAIL_URL');
const relaySecret = Deno.env.get('PORTAL_MAIL_RELAY_SECRET');
const hookSecret = Deno.env.get('PORTAL_AUTH_HOOK_SECRET')?.replace(/^v1,whsec_/, '');

const site = 'https://anastasieste.github.io/Anastasi/';
const logo = site + 'assets/icons/icon-192.png';

const messages = {
  application: {
    subject: 'Anástasi · Nueva solicitud de membresía',
    title: 'Nueva solicitud',
    copy: 'Hay una solicitud pendiente en el Portal Miembros. Inicia sesión con tu cuenta de administrador para revisarla.',
    action: 'Revisar solicitudes',
    href: site + 'solicitudes.html',
  },
  approved: {
    subject: 'Anástasi · Tu solicitud fue aprobada',
    title: 'Bienvenido a Anástasi',
    copy: 'Tu solicitud de membresía fue aprobada. Ya puedes iniciar sesión con tu correo electrónico o callsign.',
    action: 'Abrir Portal Miembros',
    href: site + '#portal',
  },
  rejected: {
    subject: 'Anástasi · Decisión sobre tu solicitud',
    title: 'Solicitud de membresía',
    copy: 'Un administrador revisó tu solicitud y decidió rechazarla. Gracias por tu interés en Anástasi.',
    action: 'Visitar Anástasi',
    href: site,
  },
};

function layout({ title, copy, action, href }) {
  return '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#050505;color:#f5f2ec;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#151312;border:1px solid #78412f;border-top:4px solid #d14a2b"><tr><td style="padding:30px"><img src="' + logo + '" width="64" height="64" alt="Anástasi" style="display:block"><p style="color:#f08063;letter-spacing:2px;font-size:12px">ANÁSTASI · PUERTO RICO</p><h1 style="color:#f5f2ec;font-size:30px;line-height:1.15">' + title + '</h1><p style="color:#d2c8bf;line-height:1.6">' + copy + '</p><p style="margin:24px 0"><a href="' + href + '" style="display:inline-block;background:#9e3523;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 18px">' + action + '</a></p><p style="color:#b4ada7;font-size:12px;border-top:1px solid #342d2a;padding-top:16px">Portal Miembros · Comunidad de Airsoft Anástasi</p></td></tr></table></td></tr></table></body></html>';
}

async function rpc(name, body) {
  const response = await fetch(project + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('No se pudo procesar la cola.');
  return response.json().catch(() => null);
}

const authenticationMessages = {
  signup: {
    subject: 'Anástasi · Confirma tu correo',
    title: 'Confirma tu correo',
    copy: 'Confirma tu dirección para enviar tu solicitud a revisión. Te avisaremos por correo cuando haya una decisión.',
    action: 'Confirmar mi correo',
    route: 'registro.html#confirmacion=',
  },
  recovery: {
    subject: 'Anástasi · Restablece tu contraseña',
    title: 'Restablece tu contraseña',
    copy: 'Abre el enlace para elegir una nueva contraseña. Si no pediste este cambio, puedes ignorar este mensaje.',
    action: 'Restablecer contraseña',
    route: 'restablecer.html#recuperacion=',
  },
  email_change: {
    subject: 'Anástasi · Confirma el cambio de correo',
    title: 'Confirma el cambio de correo',
    copy: 'Confirma el cambio que pediste en el Portal Miembros. Si recibiste un enlace en ambas direcciones, confirma los dos para completar el cambio.',
    action: 'Confirmar cambio',
    route: 'correo.html#cambio=',
  },
};

async function sendMail(id, recipient, message) {
  if (!relaySecret || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(relayUrl ?? '')) return false;
  const response = await fetch(relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: relaySecret, id, to: recipient, subject: message.subject,
      html: layout(message), text: message.copy + '\n\n' + message.href,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return response.ok && (await response.json()).sent === true;
}

async function verifiedHook(request, payload) {
  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signatures = request.headers.get('webhook-signature');
  if (!hookSecret || !id || !timestamp || !signatures || !/^\d+$/.test(timestamp)
      || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(hookSecret), x => x.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(id + '.' + timestamp + '.' + payload);
  for (const signature of signatures.split(' ')) {
    if (!/^v1,[A-Za-z0-9+/]+={0,2}$/.test(signature)) continue;
    const bytes = Uint8Array.from(atob(signature.slice(3)), x => x.charCodeAt(0));
    if (await crypto.subtle.verify('HMAC', key, bytes, signed)) return true;
  }
  return false;
}

async function sendAuthMail(request) {
  const payload = await request.text();
  if (payload.length > 16000 || !await verifiedHook(request, payload)) return new Response(null, { status: 401 });
  const { user, email_data } = JSON.parse(payload);
  const message = Object.hasOwn(authenticationMessages, email_data?.email_action_type)
    ? authenticationMessages[email_data.email_action_type] : null;
  if (!message || !user) return new Response(null, { status: 400 });
  const id = 'auth-' + request.headers.get('webhook-id');
  const targets = email_data.email_action_type === 'email_change'
    ? [{ id: id + '-new', address: user.new_email, token: email_data.token_hash }]
    : [{ id, address: user.email, token: email_data.token_hash }];
  // Supabase coloca el hash de la dirección actual en token_hash_new.
  if (email_data.email_action_type === 'email_change' && email_data.token_hash_new) {
    targets.push({ id: id + '-current', address: user.email, token: email_data.token_hash_new });
  }
  if (targets.some(({ address, token }) => typeof address !== 'string' || !address.includes('@')
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token))) {
    return new Response(null, { status: 400 });
  }
  const delivered = await Promise.all(targets.map(target => sendMail(target.id, target.address,
    { ...message, href: site + message.route + encodeURIComponent(target.token) })));
  return delivered.every(Boolean) ? Response.json({}) : new Response(null, { status: 503 });
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  try {
    if (request.headers.has('webhook-signature')) return await sendAuthMail(request);
    if (!jobSecret || request.headers.get('Authorization') !== 'Bearer ' + jobSecret) {
      return new Response(null, { status: 401 });
    }
    if (!relaySecret || !relayUrl) return new Response(null, { status: 503 });

    let sent = 0;
    for (const job of await rpc('claim_member_mail', {})) {
      let delivered = false;
      try {
        delivered = await sendMail('member-' + job.id, job.recipient, messages[job.kind]);
      } catch {
        // El correo permanece en cola para el próximo intento.
      }
      await rpc('finish_member_mail', { job: job.id, claim: job.claim_id, delivered });
      if (delivered) sent++;
    }
    return Response.json({ sent });
  } catch {
    return new Response(null, { status: 503 });
  }
});

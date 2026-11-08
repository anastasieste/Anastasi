import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const project = 'https://project.example.test';
const relay = 'https://script.google.com/macros/s/test-id/exec';
const hookSecret = Buffer.alloc(32, 8);
const mail = [];
const environment = {
  SUPABASE_URL: project, SUPABASE_SERVICE_ROLE_KEY: 'test-service', SUPABASE_ANON_KEY: 'test-anon',
  PORTAL_AUTH_HOOK_SECRET: 'v1,whsec_' + hookSecret.toString('base64'),
  PORTAL_MAIL_JOB_SECRET: 'test-job', PORTAL_MAIL_RELAY_SECRET: 'test-relay', PORTAL_MAIL_URL: relay,
};

async function loadFunction(name) {
  let handler;
  runInNewContext(await readFile(new URL('../supabase/functions/' + name + '/index.ts', import.meta.url), 'utf8'), {
    Deno: { env: { get: key => environment[key] }, serve: fn => { handler = fn; } },
    Response, AbortSignal, TextEncoder, crypto, atob,
    fetch: async (url, options) => {
      if (url.endsWith('reserve_callsign_login')) return Response.json([{ allowed: true, email: 'current@example.test' }]);
      if (url.endsWith('grant_type=password')) return Response.json({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
      });
      if (url === relay) {
        mail.push(JSON.parse(options.body));
        return Response.json({ sent: true });
      }
      throw new Error('Unexpected fetch');
    },
  });
  return handler;
}

const login = await loadFunction('callsign-login');
const credentials = await login(new Request(project, {
  method: 'POST', headers: { Origin: 'https://anastasieste.github.io' },
  body: JSON.stringify({ callsign: 'TEST', password: 'Example9!' }),
}));
assert.equal(credentials.status, 200);
assert.deepEqual(await credentials.json(), { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });

const send = await loadFunction('member-mail');
const currentHash = 'c'.repeat(64);
const newHash = 'n'.repeat(64);
const user = { email: 'current@example.test', new_email: 'new@example.test' };
async function hook(type, data, signed = true) {
  const id = 'test-message-' + type;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ user, email_data: { email_action_type: type, ...data } });
  const signature = createHmac('sha256', hookSecret).update(id + '.' + timestamp + '.' + body).digest('base64');
  return send(new Request(project, {
    method: 'POST', body,
    headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': 'v1,' + (signed ? signature : 'invalid') },
  }));
}

assert.equal((await hook('email_change', { token_hash: newHash }, false)).status, 401);
assert.equal(mail.length, 0);
assert.equal((await hook('email_change', { token_hash: newHash, token_hash_new: currentHash })).status, 200);
assert.equal(mail.length, 2);
assert.notEqual(mail[0].id, mail[1].id);
assert.match(mail.find(message => message.to === user.email).html, new RegExp('correo.html#cambio=' + currentHash));
assert.match(mail.find(message => message.to === user.new_email).html, new RegExp('correo.html#cambio=' + newHash));
assert.equal((await hook('signup', { token_hash: newHash })).status, 200);
assert.match(mail.at(-1).html, /registro\.html#confirmacion=/);
assert.equal((await hook('recovery', { token_hash: newHash })).status, 200);
assert.match(mail.at(-1).html, /restablecer\.html#recuperacion=/);
console.log('OK: callsign renovable, firma, confirmación de ambos correos, registro y recuperación.');

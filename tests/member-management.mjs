import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const member = {
  id: 'f0000000-0000-4000-8000-000000000001', callsign: 'MemberQA', full_name: '=Formula',
  email: 'member@example.test', squad: 'ANS098', role: 'member', state: 'ACTIVA', confirmed: true,
  management_revision: 0,
};
const snapshot = {
  members: [member],
  roles: [{ code: 'administrator', label: 'Administrador' }, { code: 'member', label: 'Miembro' }],
  squads: ['ANS098'],
};
const records = [Array(18).fill('')];
const validation = new Map();
const sheet = {
  getLastRow: () => records.length + 4,
  getRange: (start, column, length, width) => ({
    getFormulas: () => records.map(row => row.map(() => '')),
    getValues: () => records.map(row => [...row]),
    setValues(values) {
      values.forEach((values, index) => {
        records[index] ||= Array(18).fill('');
        records[index].splice(column - 1, width, ...values);
      });
    },
    setDataValidation: rule => validation.set(column, rule),
  }),
};
const script = {};
script.SpreadsheetApp = { newDataValidation: () => ({
  requireValueInList(values) { this.values = values; return this; },
  requireCheckbox() { return this; },
  setAllowInvalid() { return this; },
  build() { return this.values ?? 'checkbox'; },
}) };
runInNewContext(await readFile(new URL('../supabase/google-management/Code.gs', import.meta.url), 'utf8'), script);
script.syncManagement_(sheet, snapshot);
assert.equal(records.length, 1);
assert.equal(records[0][1], "'=Formula");
assert.deepEqual(validation.get(11), ['Administrador', 'Miembro']);
records[0][10] = 'Administrador';
records[0][11] = 'SUSPENDIDA';
records[0][12] = 'Motivo de prueba';
records[0][13] = true;
const [change] = script.readManagement_(sheet);
assert.equal(change.role_label, 'Administrador');
assert.equal(change.reason, 'Motivo de prueba');
assert.equal(change.expected_role, 'member');
script.syncManagement_(sheet, { ...snapshot, members: [{ ...member, squad: 'ANS456', management_revision: 1 }] });
assert.equal(records[0][15], 0);
assert.match(records[0][17], /La cuenta cambió/);
assert.equal(records[0][10], 'Administrador');
script.syncManagement_(sheet, {
  ...snapshot,
  roles: [...snapshot.roles, { code: 'moderator', label: 'Moderador' }],
  members: [{ ...member, role: 'administrator', state: 'SUSPENDIDA', suspension_reason: 'Motivo de prueba', management_revision: 1 }],
});
assert.equal(records[0][17], 'Aplicado');
assert.equal(script.readManagement_(sheet).length, 0);
assert.equal(validation.get(11).at(-1), 'Moderador');

let handler;
const calls = [];
const origin = 'https://anastasieste.github.io';
const relay = 'https://script.google.com/macros/s/Example/exec';
runInNewContext(await readFile(new URL('../supabase/functions/member-management/index.ts', import.meta.url), 'utf8'), {
  Deno: { serve: callback => { handler = callback; }, env: { get: key => ({
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'test-anon',
    PORTAL_MANAGEMENT_SECRET: 'test-only',
    PORTAL_MANAGEMENT_SHEET_ID: 'abcdefghijabcdefghij',
    PORTAL_MANAGEMENT_URL: relay,
  })[key] } },
  Response, AbortSignal,
  fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/portal_management_snapshot')) {
      return options.headers.Authorization === 'Bearer administrator'
        ? Response.json(snapshot) : Response.json({}, { status: 403 });
    }
    assert.equal(url, relay);
    return Response.json({ ok: true, result: [{ ...change }] });
  },
});
const read = token => handler(new Request('https://project.example.test', {
  method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + token }, body: '{"action":"read"}',
}));
assert.equal((await read('member')).status, 403);
assert.equal(calls.length, 1);
const result = await (await read('administrator')).json();
assert.equal(result.changes[0].role, 'administrator');
assert.equal(calls[2].options.headers.Authorization, undefined);
assert.deepEqual(JSON.parse(calls[2].options.body), { secret: 'test-only', action: 'read' });
console.log('OK: sincronización, roles dinámicos, fórmulas literales, cambios vencidos y acceso administrativo.');

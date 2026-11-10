import { account, watchMemberSession } from './account.js';
import { setupMemberMenu } from './member-menu.js';
import { setupSiteNavigation } from './site-navigation.js';

const header = document.querySelector('.header');
setupSiteNavigation(header);
const menu = setupMemberMenu(header.querySelector('.members-link'), {
  onSignIn: review => { location.href = review ? './#solicitudes' : './#gestion'; },
  onSignOut: () => { location.replace('./'); },
});
const status = document.querySelector('#management-status');
const panel = document.querySelector('#management-controls');
const signin = document.querySelector('#management-signin');
const sheet = document.querySelector('#management-sheet');
const sync = document.querySelector('#management-sync');
const preview = document.querySelector('#management-preview');
const review = document.querySelector('#management-review');
const apply = document.querySelector('#management-apply');
const cancel = document.querySelector('#management-cancel');
const list = document.querySelector('#management-changes');
let proposals = [];
let busy = false;

function clearPreview() {
  proposals = [];
  list.replaceChildren();
  review.hidden = true;
}

function report(error) {
  if (error.status === 409) return 'Una cuenta cambió desde que se preparó la propuesta. Actualiza la hoja y vuelve a prepararla.';
  if (error.code === '23505') return 'Uno de los callsigns ya está en uso.';
  if (error.code === 'sheet_not_configured' || error.code === 'sheet_unavailable') return 'La hoja privada no está disponible. Intenta de nuevo en unos minutos.';
  if (error.code === '22023') return 'Hay una propuesta inválida. Verifica la cuenta, el rol y el motivo de suspensión.';
  if (error.status === 403) return 'Esta área requiere permisos de administrador.';
  return error.message;
}

async function run(action) {
  if (busy) return;
  busy = true;
  for (const button of [sync, preview, apply, cancel]) button.disabled = true;
  try { await action(); }
  catch (error) { status.textContent = report(error); }
  finally {
    busy = false;
    for (const button of [sync, preview, apply, cancel]) button.disabled = false;
  }
}

function setSheet(result) {
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit$/.test(result.sheet_url)) return;
  sheet.href = result.sheet_url;
  sheet.hidden = false;
}

sync.addEventListener('click', () => run(async () => {
  clearPreview();
  status.textContent = 'Actualizando la hoja…';
  const result = await account.managementSheet('sync');
  setSheet(result);
  status.textContent = 'Hoja actualizada. Cuentas sincronizadas: ' + result.count + '.';
}));

preview.addEventListener('click', () => run(async () => {
  clearPreview();
  status.textContent = 'Leyendo las filas marcadas…';
  const { changes } = await account.managementSheet('read');
  if (!changes.length) {
    status.textContent = 'No hay cambios nuevos marcados para aplicar.';
    return;
  }
  proposals = changes;
  const invalid = changes.some(change => !change.current_callsign || change.role === 'invalid'
    || (change.state === 'SUSPENDIDA' && change.expected_state !== 'SUSPENDIDA' && !change.reason));
  if (invalid) {
    clearPreview();
    status.textContent = 'Revisa las filas marcadas. Cada suspensión nueva necesita un motivo y cada rol debe estar disponible.';
    return;
  }
  for (const change of changes) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = change.current_callsign;
    const details = document.createElement('p');
    details.textContent = [
      change.callsign && 'Callsign: ' + change.callsign,
      change.squad && 'Escuadrón: ' + change.squad,
      change.role_label && 'Rol: ' + change.role_label,
      change.state && 'Estado: ' + change.state,
      change.reason && change.state === 'SUSPENDIDA' && 'Motivo: ' + change.reason,
    ].filter(Boolean).join(' · ');
    item.append(title, details);
    list.append(item);
  }
  review.hidden = false;
  status.textContent = 'Revisa las propuestas antes de guardar.';
  cancel.focus();
}));

cancel.addEventListener('click', () => { clearPreview(); status.textContent = 'Revisión cancelada.'; preview.focus(); });
apply.addEventListener('click', () => run(async () => {
  if (!proposals.length) return;
  status.textContent = 'Guardando cambios en Supabase…';
  const count = await account.manageAccounts(proposals);
  clearPreview();
  status.textContent = 'Cambios guardados: ' + count + '.';
  try { setSheet(await account.managementSheet('sync')); }
  catch { status.textContent += ' Pulsa «Actualizar hoja» para volver a sincronizarla.'; }
  preview.focus();
}));

async function start() {
  try {
    const profile = await account.current();
    menu.update(profile);
    signin.hidden = Boolean(profile?.status === 'approved');
    panel.hidden = !profile?.is_admin;
    if (!profile?.is_admin) {
      clearPreview();
      status.textContent = 'Inicia sesión con una cuenta de administrador.';
      return;
    }
    await run(async () => {
      setSheet(await account.managementSheet('open'));
      status.textContent = '';
    });
  } catch (error) {
    panel.hidden = true;
    status.textContent = report(error);
  }
}

start();
watchMemberSession(start);
window.addEventListener('pageshow', event => { if (event.persisted) start(); });

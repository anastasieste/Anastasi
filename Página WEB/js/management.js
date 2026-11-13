import { account, watchMemberSession } from './account.js';
import { setupApplications } from './applications.js';
import { setupMemberMenu } from './member-menu.js?v=1.14';
import { setupSiteNavigation } from './site-navigation.js';
import { setupVideoReview } from './video-review.js?v=1.14';

const header = document.querySelector('.header');
setupSiteNavigation(header);
const menu = setupMemberMenu(header.querySelector('.members-link'), {
  onSignIn: () => { location.href = './#gestion'; },
  onSignOut: () => { location.replace('./'); },
});
const status = document.querySelector('#management-status');
const panel = document.querySelector('#management-controls');
const signin = document.querySelector('#management-signin');
const membersStatus = document.querySelector('#management-members-status');
const list = document.querySelector('#management-members');
const search = document.querySelector('#management-filter');
const applications = setupApplications(document.querySelector('#solicitudes'), id => loadMembers(id));
const videos = setupVideoReview();
const stateLabels = { ACTIVA: 'Activa', SUSPENDIDA: 'Suspendida', PENDIENTE: 'Pendiente', RECHAZADA: 'Rechazada' };
const rows = new Map();
let administrator;
let sessionVersion = 0;
let authRequest = 0;

function text(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function filterMembers() {
  const query = search.value.trim().toLocaleLowerCase('es');
  let visible = 0;
  for (const row of rows.values()) {
    row.hidden = !row.dataset.search.includes(query);
    if (!row.hidden) visible++;
  }
  membersStatus.textContent = visible ? '' : query ? 'No hay miembros que coincidan.' : 'Todavía no hay cuentas.';
}

function memberRow(member, roles) {
  const row = document.createElement('details');
  row.className = 'admin-account';
  row.dataset.search = [member.callsign, member.full_name].join(' ').toLocaleLowerCase('es');
  const summary = document.createElement('summary');
  const identity = text('span', '', 'admin-identity');
  identity.append(text('strong', member.callsign), text('span', member.squad));
  const state = text('span', stateLabels[member.state] || member.state, 'admin-state');
  state.dataset.state = member.state;
  summary.append(identity, text('span', roles.find(role => role.code === member.role)?.label || member.role, 'admin-role'), state);

  const form = document.createElement('form');
  form.method = 'post';
  form.className = 'account-form admin-account-form';
  form.innerHTML = `
    <p class="admin-contact"></p>
    <div class="admin-account-fields">
      <label>Rol <select name="role"></select></label>
      <label>Estado <select name="state"></select></label>
    </div>
    <label data-suspension hidden>Motivo de suspensión <textarea name="reason" rows="2" maxlength="1000"></textarea></label>
    <label>Nota privada <textarea name="note" rows="2" maxlength="1000"></textarea></label>
    <div class="admin-save">
      <button type="submit" class="account-submit">Guardar cambios</button>
      <p class="form-message" role="status"></p>
    </div>`;
  const details = [member.full_name, member.email];
  if (member.state === 'PENDIENTE') details.push(member.confirmed ? 'En espera de revisión' : 'Correo por confirmar');
  form.querySelector('.admin-contact').textContent = details.filter(Boolean).join(' · ');
  const { role, state: stateInput, note, reason } = form.elements;
  const editable = administrator !== member.callsign
    && (member.state === 'ACTIVA' || member.managed_suspension);
  for (const option of roles) role.add(new Option(option.label, option.code));
  role.value = member.role;
  role.disabled = stateInput.disabled = !editable;
  for (const value of editable ? ['ACTIVA', 'SUSPENDIDA'] : [member.state]) {
    stateInput.add(new Option(stateLabels[value] || value, value));
  }
  stateInput.value = member.state;
  reason.value = member.suspension_reason || '';
  note.value = member.management_note || '';
  const suspension = form.querySelector('[data-suspension]');
  function updateReason() {
    const suspended = stateInput.value === 'SUSPENDIDA';
    suspension.hidden = !suspended || (!editable && !reason.value);
    reason.disabled = !suspended || !editable;
    reason.required = suspended && editable;
  }
  updateReason();
  stateInput.addEventListener('change', updateReason);

  const save = form.querySelector('button[type="submit"]');
  const message = form.querySelector('.form-message');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    const fields = Object.fromEntries(new FormData(form));
    if (!reason.disabled && !fields.reason.trim()) {
      message.textContent = 'Escribe el motivo de suspensión.';
      message.setAttribute('data-error', '');
      reason.focus();
      return;
    }
    const change = {
      id: member.id, revision: member.management_revision,
      expected_role: member.role, expected_state: member.state,
      expected_callsign: member.callsign, expected_squad: member.squad,
      ...fields,
    };
    const controls = [role, stateInput, reason, note, save].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    message.removeAttribute('data-error');
    message.textContent = 'Guardando…';
    let saved = false;
    try {
      const changed = await account.manageAccounts([change]);
      if (!changed) { message.textContent = 'No hay cambios para guardar.'; return; }
      saved = true;
      await loadMembers(member.id, true);
    } catch (error) {
      message.setAttribute('data-error', '');
      message.textContent = saved ? 'Cambios guardados. Recarga para ver la versión actual.'
        : error.status === 409 ? 'Esta cuenta cambió. Recarga la página antes de volver a guardar.'
        : error.code === '22023' ? 'Revisa el rol, el estado y el motivo de suspensión.' : error.message;
    } finally {
      if (!saved) controls.forEach(control => { control.disabled = false; });
    }
  });
  row.append(summary, form);
  return row;
}

async function loadMembers(id, saved = false) {
  const version = sessionVersion;
  try {
    const { members, roles } = await account.managementSnapshot();
    if (version !== sessionVersion || panel.hidden) return;
    if (!id) {
      rows.clear();
      list.replaceChildren();
    }
    if (id && !members.some(member => member.id === id)) {
      rows.get(id)?.remove();
      rows.delete(id);
    }
    for (const member of members) {
      if (id && member.id !== id) continue;
      const previous = rows.get(member.id);
      const row = memberRow(member, roles);
      if (previous) {
        row.open = saved || previous.open;
        previous.replaceWith(row);
      } else list.append(row);
      rows.set(member.id, row);
      if (saved) {
        row.querySelector('.form-message').textContent = 'Cambios guardados.';
        row.querySelector('button[type="submit"]').focus();
      }
    }
    filterMembers();
  } catch (error) {
    if (saved) throw error;
    if (version === sessionVersion) membersStatus.textContent = 'No se pudieron cargar las cuentas. Recarga la página.';
  }
}

search.addEventListener('input', filterMembers);
async function start() {
  const request = ++authRequest;
  try {
    const profile = await account.current();
    if (request !== authRequest) return;
    menu.update(profile);
    signin.hidden = profile?.status === 'approved';
    const previous = administrator;
    administrator = profile?.is_admin ? profile.callsign : undefined;
    panel.hidden = !administrator;
    status.textContent = administrator ? ''
      : signin.hidden ? 'Esta página requiere permisos de administrador.' : 'Inicia sesión con una cuenta de administrador.';
    if (administrator === previous) return;
    sessionVersion++;
    if (previous) { applications.setEnabled(false); videos.setEnabled(false); }
    if (administrator) {
      applications.setEnabled(true);
      videos.setEnabled(true);
      membersStatus.textContent = 'Cargando miembros…';
      await loadMembers();
    } else {
      rows.clear();
      list.replaceChildren();
    }
  } catch (error) {
    if (request !== authRequest) return;
    sessionVersion++;
    administrator = undefined;
    panel.hidden = true;
    applications.setEnabled(false);
    videos.setEnabled(false);
    rows.clear();
    list.replaceChildren();
    status.textContent = error.message;
  }
}

start();
watchMemberSession(start);
window.addEventListener('pageshow', event => { if (event.persisted) start(); });

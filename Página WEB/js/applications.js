import { account } from './account.js';

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

const date = new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeStyle: 'short' });

export function setupApplications(onSignIn) {
  const dialog = document.createElement('dialog');
  dialog.className = 'applications-dialog';
  dialog.setAttribute('aria-labelledby', 'applications-title');
  dialog.innerHTML = `
    <button type="button" class="dialog-close" autofocus>Cerrar <span aria-hidden="true">×</span></button>
    <p class="eyebrow">ANÁSTASI · ADMINISTRACIÓN</p>
    <h2 id="applications-title">Solicitudes de membresía</h2>
    <p class="application-message" role="status"></p>
    <button type="button" class="account-submit application-signin" hidden>Abrir Portal Miembros</button>
    <div class="application-list"></div>
    <details class="application-history" hidden>
      <summary>Historial reciente</summary>
      <p class="history-status" role="status"></p>
      <div class="history-list"></div>
    </details>`;
  document.body.append(dialog);
  const status = dialog.querySelector('.application-message');
  const list = dialog.querySelector('.application-list');
  const signIn = dialog.querySelector('.application-signin');
  const history = dialog.querySelector('.application-history');
  const historyStatus = history.querySelector('.history-status');
  const historyList = history.querySelector('.history-list');
  let generation = 0;
  let historyLoaded = false;
  let historyRequest = 0;
  let opener;

  function dismiss() {
    if (!dialog.open) return;
    dialog.close();
    generation++;
    list.replaceChildren();
    historyList.replaceChildren();
  }

  dialog.querySelector('.dialog-close').addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => {
    if (dialog.open || !opener?.isConnected) return;
    if (getComputedStyle(opener).visibility === 'visible') opener.focus();
    else document.querySelector('.menu-toggle')?.focus();
  });
  signIn.addEventListener('click', () => { dismiss(); onSignIn(); });
  history.addEventListener('toggle', () => { if (history.open) loadHistory(); });

  async function loadHistory() {
    if (historyLoaded || history.hidden || !dialog.open) return;
    historyLoaded = true;
    const request = generation;
    const sequence = ++historyRequest;
    historyStatus.textContent = 'Cargando historial…';
    try {
      const entries = await account.applicationHistory();
      if (request !== generation || sequence !== historyRequest) return;
      historyStatus.textContent = entries.length ? '' : 'Todavía no hay decisiones registradas.';
      historyList.replaceChildren(...entries.map(entry => {
        const record = document.createElement('article');
        record.className = 'application-history-entry';
        record.append(
          text('h3', entry.callsign + ' · ' + (entry.status === 'approved' ? 'Aprobada' : 'Rechazada')),
          text('p', [date.format(new Date(entry.decided_at)), entry.administrator].filter(Boolean).join(' · ')),
        );
        if (entry.note) record.append(text('p', entry.note, 'member-preformatted'));
        return record;
      }));
    } catch (error) {
      if (request !== generation || sequence !== historyRequest) return;
      historyLoaded = false;
      historyStatus.textContent = error.message;
    }
  }

  function applicationRow(application) {
    const row = document.createElement('details');
    row.className = 'application-row';
    const summary = document.createElement('summary');
    const identity = document.createElement('span');
    identity.append(text('strong', application.callsign), text('span', application.full_name));
    const submitted = text('time', date.format(new Date(application.created_at)));
    submitted.dateTime = application.created_at;
    summary.append(identity, text('span', application.squad), submitted, text('span', 'Pendiente', 'pending-badge'));

    const form = document.createElement('form');
    form.className = 'account-form application-details';
    form.method = 'post';
    form.innerHTML = `
      <p class="application-email"></p>
      <label>Nota administrativa <textarea name="note" maxlength="1000" rows="3"></textarea>
        <small>Opcional. Solo la pueden consultar administradores.</small>
      </label>
      <div class="member-actions" data-decision-actions>
        <button type="button" class="account-submit" data-decision="approve">Aceptar</button>
        <button type="button" class="dialog-close" data-decision="reject">Rechazar</button>
      </div>
      <div class="application-confirm" hidden>
        <p></p>
        <div class="confirmation-actions">
          <button type="submit" class="account-submit">Confirmar</button>
          <button type="button" class="dialog-close" data-cancel>Cancelar</button>
        </div>
      </div>`;
    form.querySelector('.application-email').textContent = 'Correo: ' + application.email;
    const confirmation = form.querySelector('.application-confirm');
    const actions = form.querySelector('[data-decision-actions]');
    const controls = [...form.querySelectorAll('button, textarea')];
    let decision;
    let actionButton;
    for (const action of form.querySelectorAll('[data-decision]')) {
      action.addEventListener('click', () => {
        actionButton = action;
        decision = action.dataset.decision === 'approve';
        confirmation.querySelector('p').textContent = decision
          ? '¿Aceptar la solicitud de ' + application.callsign + '?'
          : '¿Rechazar la solicitud de ' + application.callsign + '?';
        confirmation.hidden = false;
        actions.hidden = true;
        confirmation.querySelector('[data-cancel]').focus();
      });
    }
    form.querySelector('[data-cancel]').addEventListener('click', () => {
      confirmation.hidden = true;
      actions.hidden = false;
      decision = undefined;
      actionButton.focus();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (decision === undefined || controls.some(control => control.disabled)) return;
      const request = generation;
      const note = form.elements.note.value.trim();
      controls.forEach(control => { control.disabled = true; });
      try {
        await account.decide(application.id, decision, note);
        if (request !== generation) return;
        const message = decision ? 'Solicitud aprobada. Correo en cola.' : 'Solicitud rechazada. Correo en cola.';
        (row.nextElementSibling?.querySelector('summary') || dialog.querySelector('.dialog-close')).focus();
        row.remove();
        status.textContent = message;
        historyLoaded = false;
        if (history.open) loadHistory();
        if (!list.children.length) await loadApplications(request, message);
      } catch (error) {
        if (request !== generation) return;
        if (error.status === 409) {
          dialog.querySelector('.dialog-close').focus();
          row.remove();
          await loadApplications(request, 'Otro administrador ya procesó esta solicitud o dejó de estar disponible.');
        } else {
          status.textContent = error.message;
          controls.forEach(control => { control.disabled = false; });
          form.querySelector('[type="submit"]').focus();
        }
      }
    });
    row.append(summary, form);
    return row;
  }

  async function loadApplications(request, message = '') {
    try {
      const applications = await account.pendingApplications();
      if (request !== generation) return;
      list.replaceChildren(...applications.map(applicationRow));
      status.textContent = message || (applications.length ? '' : 'No hay solicitudes pendientes.');
    } catch {
      if (request !== generation) return;
      status.textContent = [message, 'No se pudieron cargar las solicitudes. Vuelve a abrir la ventana.'].filter(Boolean).join(' ');
    }
  }

  async function open(profile, trigger = document.activeElement) {
    if (dialog.open) return;
    const request = ++generation;
    opener = trigger;
    list.replaceChildren();
    historyList.replaceChildren();
    history.open = false;
    historyLoaded = false;
    history.hidden = !profile?.is_admin;
    signIn.hidden = Boolean(profile);
    status.textContent = profile?.is_admin ? 'Cargando solicitudes…'
      : profile ? 'Esta área requiere una cuenta de administrador.' : 'Inicia sesión con una cuenta de administrador.';
    dialog.showModal();
    if (profile?.is_admin) await loadApplications(request);
  }

  return { open, dismiss };
}

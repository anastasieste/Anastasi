import { account } from './account.js';

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

const date = new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeStyle: 'short' });

export function setupApplications(section, onDecision) {
  const pending = section.querySelector('#applications-pending');
  const status = pending.querySelector('.application-message');
  const list = pending.querySelector('.application-list');
  const history = section.querySelector('#applications-history');
  const historyStatus = history.querySelector('.history-status');
  const historyList = history.querySelector('.history-list');
  const views = [...section.querySelectorAll('[data-application-view]')];
  let enabled = false;
  let generation = 0;
  let historyLoaded = false;
  let historyRequest = 0;

  for (const button of views) {
    button.addEventListener('click', () => {
      const showHistory = button.dataset.applicationView === 'history';
      pending.hidden = showHistory;
      history.hidden = !showHistory;
      for (const view of views) view.setAttribute('aria-pressed', String(view === button));
      if (showHistory) loadHistory();
    });
  }

  async function loadHistory() {
    if (historyLoaded || !enabled) return;
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
        (row.nextElementSibling?.querySelector('summary') || views[0]).focus();
        row.remove();
        status.textContent = message;
        historyLoaded = false;
        if (!history.hidden) loadHistory();
        onDecision(application.id);
        if (!list.children.length) await loadApplications(request, message);
      } catch (error) {
        if (request !== generation) return;
        if (error.status === 409) {
          views[0].focus();
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
      status.textContent = [message, 'No se pudieron cargar las solicitudes. Recarga la página.'].filter(Boolean).join(' ');
    }
  }

  function setEnabled(active) {
    if (enabled === active) return;
    enabled = active;
    const request = ++generation;
    list.replaceChildren();
    historyList.replaceChildren();
    historyLoaded = false;
    status.textContent = '';
    historyStatus.textContent = '';
    if (!active) return;
    pending.hidden = false;
    history.hidden = true;
    for (const view of views) view.setAttribute('aria-pressed', String(view === views[0]));
    status.textContent = 'Cargando solicitudes…';
    loadApplications(request);
  }

  return { setEnabled };
}

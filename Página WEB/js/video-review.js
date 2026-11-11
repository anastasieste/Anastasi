import { account, videoPlayback } from './account.js';

export function setupVideoReview() {
  const list = document.querySelector('#admin-video-list');
  const status = document.querySelector('#admin-video-status');
  const panel = document.querySelector('#admin-video-section');
  const tabs = [...document.querySelectorAll('[data-admin-section]')];
  const memberPanels = ['solicitudes', 'admin-members-section'].map(id => document.getElementById(id));
  const date = new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeStyle: 'short' });
  let enabled = false;
  let version = 0;

  function clearPlayback() {
    for (const video of list.querySelectorAll('video')) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }
  function select(videos) {
    panel.hidden = !videos;
    memberPanels.forEach(section => { section.hidden = videos; });
    tabs.forEach(button => button.setAttribute('aria-pressed', String((button.dataset.adminSection === 'videos') === videos)));
    if (videos) load();
    else { version++; clearPlayback(); list.replaceChildren(); }
  }
  function create(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function row(record) {
    const details = create('details', '', 'admin-member');
    const summary = create('summary');
    summary.append(create('strong', record.title), create('span', ' · ' + record.callsign + ' · ' + date.format(new Date(record.submitted_at))));
    const player = create('video', '', 'video-review-player');
    player.hidden = true;
    player.controls = true;
    player.playsInline = true;
    player.preload = 'metadata';
    const actions = create('div', '', 'video-actions');
    const view = create('button', 'Cargar video', 'account-submit');
    const approve = create('button', 'Aprobar', 'account-submit');
    const reject = create('button', 'Rechazar', 'account-submit');
    view.type = approve.type = reject.type = 'button';
    const message = create('p', '', 'form-message');
    message.setAttribute('role', 'status');
    view.addEventListener('click', async () => {
      view.disabled = true;
      message.textContent = 'Cargando video…';
      try {
        const { ticket } = await account.videoPreview(record.id);
        if (!details.isConnected || !details.open) return;
        player.src = videoPlayback(record.id, ticket);
        player.hidden = false;
        message.textContent = '';
      } catch (error) { message.textContent = error.message; }
      finally { view.disabled = false; }
    });
    player.addEventListener('error', () => {
      if (player.hasAttribute('src')) message.textContent = 'Pulsa Cargar video para renovar el acceso.';
    });
    details.addEventListener('toggle', () => { if (!details.open) player.pause(); });
    function updateDecisionButtons(busy) {
      approve.disabled = busy || record.decision === 'rejected';
      reject.disabled = busy || record.decision === 'approved';
    }
    updateDecisionButtons(false);
    for (const [button, decision, verb] of [[approve, 'approved', 'aprobar'], [reject, 'rejected', 'rechazar']]) {
      button.addEventListener('click', async () => {
        if (!window.confirm(`¿Quieres ${verb} «${record.title}»?`)) return;
        updateDecisionButtons(true);
        message.textContent = 'Guardando decisión…';
        try {
          await account.videoDecision(record.id, decision);
          if (enabled && !panel.hidden) await load(decision === 'approved' ? 'Video aprobado y publicado.' : 'Video rechazado.');
        } catch (error) {
          message.textContent = error.message;
        } finally { updateDecisionButtons(false); }
      });
    }
    actions.append(view, approve, reject);
    details.append(summary, player, actions, message);
    return details;
  }
  async function load(feedback = '') {
    const current = ++version;
    status.textContent = 'Cargando videos…';
    try {
      const records = await account.videoQueue();
      if (current !== version || !enabled || panel.hidden) return;
      clearPlayback();
      list.replaceChildren(...records.map(row));
      status.textContent = [feedback, records.length ? '' : 'No hay videos pendientes.'].filter(Boolean).join(' ');
    } catch (error) { if (current === version) status.textContent = error.message; }
  }
  tabs.forEach(button => button.addEventListener('click', () => { if (enabled) select(button.dataset.adminSection === 'videos'); }));
  return { setEnabled(value) { enabled = value; select(false); } };
}

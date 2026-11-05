import { account, accountsReady, initializeAccountForms } from './account.js';

const status = document.querySelector('#application-status');
const list = document.querySelector('#application-list');

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function renderApplications() {
  const applications = await account.pendingApplications();
  list.replaceChildren();
  status.textContent = applications.length ? '' : 'No hay solicitudes pendientes.';
  for (const application of applications) {
    const card = element('article', '', 'application-card');
    card.append(element('h2', application.callsign), element('p', application.full_name),
      element('p', application.squad), element('p', application.email));
    for (const [label, approved] of [['Aceptar', true], ['Rechazar', false]]) {
      const button = element('button', label, approved ? 'account-submit' : 'dialog-close');
      button.type = 'button';
      button.setAttribute('aria-label', label + ' solicitud de ' + application.callsign);
      button.addEventListener('click', async () => {
        if (!window.confirm(label + ' la solicitud de ' + application.callsign + '?')) return;
        const controls = [...card.querySelectorAll('button')];
        controls.forEach(control => { control.disabled = true; });
        try {
          await account.decide(application.id, approved);
        } catch {
          status.textContent = 'No se pudo guardar la decisión. Recarga para comprobar si otro administrador ya la procesó.';
          controls.forEach(control => { control.disabled = false; });
          return;
        }
        card.remove();
        status.textContent = approved ? 'Solicitud aprobada. Correo en cola.' : 'Solicitud rechazada. Correo en cola.';
        if (!list.children.length) {
          try { await renderApplications(); }
          catch { status.textContent += ' Recarga para ver otras solicitudes.'; }
        }
      });
      card.append(button);
    }
    list.append(card);
  }
}

async function start() {
  if (!accountsReady) return;
  initializeAccountForms();
  try {
    const profile = await account.current();
    if (!profile?.is_admin) {
      status.append('Inicia sesión con una cuenta de administrador. ',
        Object.assign(element('a', 'Abrir Portal Miembros', 'text-link'), { href: './#portal' }));
      return;
    }
    await renderApplications();
  } catch {
    status.textContent = 'No se pudieron cargar las solicitudes. Vuelve a iniciar sesión e inténtalo otra vez.';
  }
}

start();

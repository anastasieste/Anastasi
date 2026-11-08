import { account } from './account.js';
import { setupApplications } from './applications.js';

export function setupMemberMenu(button, { onSignIn, onSignOut, loginDialog = false }) {
  const root = document.createElement('div');
  root.className = 'member-menu';
  button.before(root);
  root.append(button);
  button.innerHTML = '<span class="member-menu-label">Portal Miembros</span><span class="member-chevron" aria-hidden="true" hidden></span>';
  const label = button.querySelector('.member-menu-label');
  const chevron = button.querySelector('.member-chevron');
  const options = document.createElement('div');
  options.id = 'member-options';
  options.className = 'member-options';
  options.hidden = true;
  options.innerHTML = `
    <a href="perfil.html">Mi perfil</a>
    <a href="editor.html">Editor</a>
    <a href="miembros.html">Miembros</a>
    <button type="button" data-admin hidden>Revisar solicitudes</button>
    <button type="button" class="member-signout">Cerrar sesión</button>`;
  root.append(options);
  const review = options.querySelector('[data-admin]');
  const logout = options.querySelector('.member-signout');
  const applications = setupApplications(() => onSignIn(true));
  let profile = null;

  function close() {
    options.hidden = true;
    if (profile) button.setAttribute('aria-expanded', 'false');
  }

  function update(next) {
    const current = next?.status === 'approved' ? next : null;
    if (!current?.is_admin) applications.dismiss();
    if (profile?.callsign !== current?.callsign || profile?.is_admin !== current?.is_admin) close();
    profile = current;
    label.textContent = profile ? 'Hola, ' + profile.callsign : 'Portal Miembros';
    chevron.hidden = !profile;
    review.hidden = !profile?.is_admin;
    if (profile) {
      button.setAttribute('aria-controls', options.id);
      button.setAttribute('aria-expanded', String(!options.hidden));
      button.removeAttribute('aria-haspopup');
    } else {
      button.removeAttribute('aria-expanded');
      if (loginDialog) {
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'miembros');
      } else {
        button.removeAttribute('aria-controls');
      }
    }
  }

  button.addEventListener('click', () => {
    if (!profile) { onSignIn(false); return; }
    if (!options.hidden) { close(); return; }
    options.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', event => { if (!root.contains(event.target)) close(); });
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget)) close();
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || options.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    button.focus();
  });
  options.addEventListener('click', () => close());
  review.addEventListener('click', () => applications.open(profile, button));
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try { await account.signOut(); }
    catch { /* La sesión ya se eliminó de este navegador. */ }
    finally {
      logout.disabled = false;
      update(null);
      onSignOut();
      button.focus();
    }
  });

  update(null);
  return { update, close, openApplications: () => applications.open(profile, button) };
}

import { carouselImages, carouselSettings, squadCodes, galleryItems } from './data/content.js?v=1.2';
import { CinematicCarousel } from './components/carousel.js';
import { renderSquads, setupGallery } from './components/collections.js';
import { account, formMessage, initializeAccountForms, submitAccountForm } from './account.js';

new CinematicCarousel(document.querySelector('.carousel'), carouselImages, carouselSettings);
account.squadCounts().then(counts => {
  const squads = squadCodes.flatMap(code => {
    const count = counts.get(code);
    if (!Number.isSafeInteger(count) || count < 1) return [];
    return [{ code, name: code, description: count === 1 ? '1 miembro' : count + ' miembros' }];
  });
  renderSquads(document.querySelector('#squad-list'), squads);
}).catch(() => {});
setupGallery(galleryItems);
document.querySelector('#year').textContent = new Date().getFullYear();

const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navegacion');
const desktop = matchMedia('(min-width: 768px)');
function closeMenu(returnFocus = false) {
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Abrir menú');
  nav.classList.remove('is-open');
  if (returnFocus) toggle.focus();
}
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  nav.classList.toggle('is-open', open);
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu()));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') closeMenu(true); });
document.addEventListener('click', event => { if (!event.target.closest('.header')) closeMenu(); });
document.querySelector('.header').addEventListener('focusout', event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); });
desktop.addEventListener('change', () => closeMenu());

const portalButton = nav.querySelector('.members-link');
const portal = document.querySelector('#miembros');
const loginForm = portal.querySelector('#login-form');
const recoveryForm = portal.querySelector('#recovery-form');
const titles = { login: 'portal-title', recover: 'recovery-title', member: 'member-title' };
initializeAccountForms(portal);

function showPortalView(view, moveFocus = true) {
  for (const panel of portal.querySelectorAll('[data-portal-panel]')) {
    panel.hidden = panel.dataset.portalPanel !== view;
  }
  portal.setAttribute('aria-labelledby', titles[view]);
  if (moveFocus) document.getElementById(titles[view]).focus();
}

function showMember(profile) {
  document.querySelector('#member-greeting').textContent = `Sesión iniciada como ${profile.callsign}.`;
  portal.querySelector('#admin-link').hidden = !profile.is_admin;
  showPortalView('member');
}

function openPortal() {
  closeMenu();
  showPortalView('login', false);
  portal.showModal();
  account.current().then(profile => {
    if (profile?.status === 'approved' && portal.open && !loginForm.closest('[hidden]')) showMember(profile);
  }).catch(() => {});
}

portalButton.addEventListener('click', openPortal);
portal.querySelector('.dialog-close').addEventListener('click', () => portal.close());
portal.addEventListener('close', () => {
  loginForm.reset();
  recoveryForm.reset();
  formMessage(loginForm, '');
  formMessage(recoveryForm, '');
  (desktop.matches ? portalButton : toggle).focus();
});
for (const button of portal.querySelectorAll('[data-portal-view]')) {
  button.addEventListener('click', () => showPortalView(button.dataset.portalView));
}
loginForm.addEventListener('submit', event => {
  event.preventDefault();
  submitAccountForm(loginForm, 'Iniciando sesión…', async ({ identifier, password }) => {
    const profile = await account.signIn(identifier.trim(), password);
    loginForm.reset();
    if (portal.open) showMember(profile);
  });
});
recoveryForm.addEventListener('submit', event => {
  event.preventDefault();
  submitAccountForm(recoveryForm, 'Solicitando enlace…', async ({ email }) => {
    await account.recover(email.trim());
    recoveryForm.reset();
    formMessage(recoveryForm, 'Si el correo está asociado a una cuenta, recibirás un enlace para restablecer tu contraseña.');
  });
});
portal.querySelector('#sign-out').addEventListener('click', async () => {
  try { await account.signOut(); }
  catch { /* La sesión de esta pestaña ya se eliminó. */ }
  finally { if (portal.open) showPortalView('login'); }
});
if (location.hash === '#portal') {
  history.replaceState(null, '', location.pathname + location.search);
  openPortal();
}

const motion = matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window) {
  if (!motion.matches) document.documentElement.classList.add('js-motion');
  const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(element => reveal.observe(element));
  const links = [...nav.querySelectorAll('a')];
  const activeSections = new Set();
  const sections = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? activeSections.add(entry.target.id) : activeSections.delete(entry.target.id));
    const active = links.find(link => activeSections.has(link.hash.slice(1)));
    if (active) links.forEach(link => { if (link === active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  }, { rootMargin: '-96px 0px 0px' });
  links.forEach(link => sections.observe(document.querySelector(link.hash)));
}
motion.addEventListener('change', event => { if (event.matches) document.documentElement.classList.remove('js-motion'); });

// El sitio funciona sin SW. La caché conserva únicamente la estructura básica.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => console.info('El modo sin conexión no está disponible.', error));
  });
}

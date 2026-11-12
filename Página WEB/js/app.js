import { carouselSettings, squadCodes, galleryItems } from './data/content.js?v=1.8';
import { accountConfig } from './data/account-config.js';
import { CinematicCarousel } from './components/carousel.js?v=1.9';
import { renderSquads, setupGallery, setupSquadRoster } from './components/collections.js?v=1.11';
import { account, formMessage, initializeAccountForms, publicSquadAvatar, submitAccountForm, videoCover, videoPlayback, watchMemberSession } from './account.js?v=1.11';
import { setupMemberMenu } from './member-menu.js';
import { setupSiteNavigation } from './site-navigation.js';

const photoFeed = `${accountConfig.url}/functions/v1/site-photos`;
function photoSource(section, { id, version }) {
  return `${photoFeed}?${new URLSearchParams({ section, id, v: version })}`;
}
fetch(photoFeed).then(async response => {
  if (!response.ok) return;
  const { carousel, about } = await response.json();
  if (carousel.length) {
    const images = carousel.map((photo, index) => ({
      src: photoSource('carousel', photo),
      alt: `Fotografía ${index + 1} de Anástasi`,
    }));
    new CinematicCarousel(document.querySelector('.carousel'), images, carouselSettings);
  }
  if (about.length) {
    const photos = document.querySelector('.about-photos');
    photos.append(...about.map((photo, index) => {
      const image = document.createElement('img');
      image.alt = `Fotografía ${index + 1} de la comunidad Anástasi`;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.fetchPriority = 'low';
      if (photo.width && photo.height) {
        image.width = photo.width;
        image.height = photo.height;
      }
      image.src = photoSource('about', photo);
      return image;
    }));
    photos.hidden = false;
  }
}).catch(() => {});
const openSquadRoster = setupSquadRoster(document.querySelector('#squad-roster-dialog'), account.publicSquadRoster, publicSquadAvatar);
account.squadCounts().then(counts => {
  const squads = squadCodes.flatMap(code => {
    const count = counts.get(code);
    if (!Number.isSafeInteger(count) || count < 1) return [];
    return [{ code, name: code, description: count === 1 ? '1 miembro' : count + ' miembros' }];
  });
  renderSquads(document.querySelector('#squad-list'), squads, openSquadRoster);
}).catch(() => {});
const showPublishedVideos = setupGallery(galleryItems);
let galleryVersion = 0;
async function refreshGallery() {
  const version = ++galleryVersion;
  const items = await account.publicVideos().catch(() => []);
  if (version !== galleryVersion) return;
  showPublishedVideos(items.map(item => ({
    type: 'video', title: item.title, src: videoPlayback(item.id), thumbnail: item.has_cover ? videoCover(item.id) : null,
  })));
}
refreshGallery();
window.addEventListener('hashchange', () => { if (location.hash === '#galeria') refreshGallery(); });
window.addEventListener('pageshow', event => { if (event.persisted) refreshGallery(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && location.hash === '#galeria') refreshGallery(); });
document.querySelector('#year').textContent = new Date().getFullYear();

const { nav, toggle, desktop, closeMenu } = setupSiteNavigation(document.querySelector('.header'));
const sectionLinks = [...nav.querySelectorAll('a[href^="#"]')];
const sections = sectionLinks.map(link => document.getElementById(link.hash.slice(1)));
let activeAnchor = false;
let anchorTimer;
let scrollFrame;

function setActiveSection(index) {
  sectionLinks.forEach((link, current) => {
    if (current === index) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function releaseAnchor() {
  clearTimeout(anchorTimer);
  activeAnchor = false;
}

function finishAnchorAfterScroll() {
  clearTimeout(anchorTimer);
  anchorTimer = setTimeout(releaseAnchor, 160);
}

function selectAnchor(hash) {
  const index = sectionLinks.findIndex(link => link.hash === hash);
  if (index < 0) return;
  setActiveSection(index);
  activeAnchor = true;
  finishAnchorAfterScroll();
}

function updateSectionFromScroll() {
  if (activeAnchor) {
    finishAnchorAfterScroll();
    return;
  }
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    if (activeAnchor) return;
    const page = document.documentElement;
    const atBottom = scrollY > 0 && page.scrollHeight - (scrollY + innerHeight) <= 2;
    const offset = parseFloat(getComputedStyle(page).scrollPaddingTop) + 2;
    const index = atBottom ? sections.length - 1 : sections.findLastIndex(section => section.getBoundingClientRect().top <= offset);
    setActiveSection(Math.max(index, 0));
  });
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) selectAnchor(link.hash);
});
window.addEventListener('hashchange', () => selectAnchor(location.hash));
window.addEventListener('scroll', updateSectionFromScroll, { passive: true });
window.addEventListener('scrollend', releaseAnchor);
window.addEventListener('wheel', releaseAnchor, { passive: true });
window.addEventListener('touchmove', releaseAnchor, { passive: true });
window.addEventListener('resize', updateSectionFromScroll);
selectAnchor(location.hash);

const portalButton = nav.querySelector('.members-link');
const portal = document.querySelector('#miembros');
const loginForm = portal.querySelector('#login-form');
const recoveryForm = portal.querySelector('#recovery-form');
const titles = { login: 'portal-title', recover: 'recovery-title' };
const menu = setupMemberMenu(portalButton, {
  onSignIn: () => openPortal(),
  onSignOut: () => { if (portal.open) portal.close(); },
  loginDialog: true,
});
let managementAfterSignIn = false;
let memberVersion = 0;
initializeAccountForms(portal);

function showPortalView(view, moveFocus = true) {
  for (const panel of portal.querySelectorAll('[data-portal-panel]')) {
    panel.hidden = panel.dataset.portalPanel !== view;
  }
  portal.setAttribute('aria-labelledby', titles[view]);
  if (moveFocus) document.getElementById(titles[view]).focus();
}

function openPortal(management = false) {
  closeMenu();
  managementAfterSignIn = management;
  showPortalView('login', false);
  if (!portal.open) portal.showModal();
  if (management) formMessage(loginForm, 'Inicia sesión con una cuenta de administrador para abrir el Panel Admin.');
}

portal.querySelector('.dialog-close').addEventListener('click', () => portal.close());
portal.addEventListener('close', () => {
  if (portal.open) return;
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
    memberVersion++;
    loginForm.reset();
    menu.update(profile);
    if (portal.open) portal.close();
    if (managementAfterSignIn) location.href = 'gestion.html';
    else if (!desktop.matches) toggle.click();
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
async function syncMember() {
  const version = ++memberVersion;
  let profile;
  try { profile = await account.current(); }
  catch { /* Los controles públicos siguen disponibles si Auth no responde. */ }
  if (version === memberVersion) menu.update(profile);
  return profile;
}

async function handlePortalRoute() {
  const hash = location.hash;
  if (!['#portal', '#solicitudes', '#gestion'].includes(hash)) return;
  history.replaceState(null, '', location.pathname + location.search);
  const profile = await syncMember();
  if (hash === '#solicitudes' || hash === '#gestion') {
    if (profile?.status === 'approved') location.href = 'gestion.html';
    else openPortal(true);
  }
  else if (!profile || profile.status !== 'approved') openPortal();
  else if (!desktop.matches && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
}

if (['#portal', '#solicitudes', '#gestion'].includes(location.hash)) handlePortalRoute();
else syncMember();
window.addEventListener('hashchange', handlePortalRoute);
watchMemberSession(syncMember);
window.addEventListener('pageshow', event => { if (event.persisted) syncMember(); });

const motion = matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window) {
  if (!motion.matches) document.documentElement.classList.add('js-motion');
  const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(element => reveal.observe(element));
}
motion.addEventListener('change', event => { if (event.matches) document.documentElement.classList.remove('js-motion'); });

// El sitio funciona sin SW. La caché conserva únicamente la estructura básica.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => console.info('El modo sin conexión no está disponible.', error));
  });
}

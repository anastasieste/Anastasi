import { carouselImages, carouselSettings, squads, galleryItems } from './data/content.js';
import { CinematicCarousel } from './components/carousel.js';
import { renderSquads, setupGallery } from './components/collections.js';

new CinematicCarousel(document.querySelector('.carousel'), carouselImages, carouselSettings);
renderSquads(document.querySelector('#squad-list'), squads);
setupGallery(galleryItems);
document.querySelector('#year').textContent = new Date().getFullYear();

const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navegacion');
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
matchMedia('(min-width: 681px)').addEventListener('change', () => closeMenu());

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
  }, { rootMargin: '-15% 0px -45% 0px' });
  links.forEach(link => sections.observe(document.querySelector(link.hash)));
}
motion.addEventListener('change', event => { if (event.matches) document.documentElement.classList.remove('js-motion'); });

// El sitio funciona sin SW. La caché conserva únicamente la estructura básica.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => console.info('El modo sin conexión no está disponible.', error));
  });
}

export function setupSiteNavigation(header) {
  let nav = header.querySelector('nav');
  let toggle = header.querySelector('.menu-toggle');
  if (!nav) {
    const accountButton = header.querySelector('.members-link');
    nav = document.createElement('nav');
    nav.id = 'navegacion';
    nav.setAttribute('aria-label', 'Navegación principal');
    nav.innerHTML = `<a href="./#inicio">Inicio</a><a href="./#nosotros">Nosotros</a>
      <a href="./#filosofia">Filosofía</a><a href="./#escuadrones">Escuadrones</a><a href="./#galeria">Galería</a>`;
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'menu-toggle';
    toggle.setAttribute('aria-controls', nav.id);
    toggle.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span>';
    accountButton.before(toggle, nav);
    nav.append(accountButton);
  }
  const desktop = matchMedia('(min-width: 768px)');
  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    nav.classList.toggle('is-open', open);
  }
  function closeMenu() { setOpen(false); }
  setOpen(false);
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('is-open')) {
      closeMenu();
      toggle.focus();
    }
  });
  document.addEventListener('click', event => { if (!header.contains(event.target)) closeMenu(); });
  header.addEventListener('focusout', event => { if (!header.contains(event.relatedTarget)) closeMenu(); });
  desktop.addEventListener('change', closeMenu);
  return { nav, toggle, desktop, closeMenu };
}

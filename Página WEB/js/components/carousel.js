const modulo = (value, length) => ((value % length) + length) % length;

export class CinematicCarousel {
  constructor(root, images, settings = {}) {
    this.root = root;
    this.images = [...images].sort((a, b) => a.order - b.order);
    this.interval = Math.max(1500, settings.interval ?? 4800);
    this.duration = Math.max(0, settings.duration ?? 850);
    this.index = 0;
    this.busy = false;
    this.paused = false;
    this.reasons = new Set();
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.abort = new AbortController();
    this.cards = [];
    this.stage = root.querySelector('.carousel-stage');
    this.pauseButton = root.querySelector('[data-carousel="pause"]');
    root.style.setProperty('--transition', `${this.duration}ms`);
    this.build();
    this.bind();
    this.updateCaption();
    this.schedule();
  }

  on(element, event, handler, options = {}) {
    element.addEventListener(event, handler, { ...options, signal: this.abort.signal });
  }

  build() {
    if (!this.images.length) {
      this.stage.classList.add('gallery-empty');
      const message = document.createElement('p');
      message.textContent = 'Las fotografías de Anástasi están por llegar.';
      this.stage.append(message);
    }
    // Cinco posiciones reciclables permiten un loop continuo, incluso con dos imágenes.
    const positions = this.images.length > 1 ? [-2, -1, 0, 1, 2] : this.images.length ? [0] : [];
    for (const position of positions) {
      const element = document.createElement('figure');
      element.className = 'carousel-card';
      element.setAttribute('role', 'group');
      element.setAttribute('aria-roledescription', 'diapositiva');
      const img = document.createElement('img');
      img.className = 'slide-image';
      img.width = 1600;
      img.height = 900;
      img.draggable = false;
      img.decoding = 'async';
      const frame = document.createElement('div');
      frame.className = 'slide-frame';
      frame.append(img);
      const reflection = document.createElement('div');
      reflection.className = 'reflection';
      reflection.setAttribute('aria-hidden', 'true');
      const reflected = document.createElement('img');
      reflected.alt = '';
      reflected.draggable = false;
      const reflectedFrame = frame.cloneNode(false);
      reflectedFrame.append(reflected);
      reflection.append(reflectedFrame);
      const button = document.createElement('button');
      button.className = 'slide-select';
      element.append(frame, reflection, button);
      this.stage.append(element);
      const card = { element, img, reflected, button, position };
      this.cards.push(card);
      this.fill(card, modulo(position, this.images.length));
      this.position(card);
      this.on(button, 'click', () => {
        if (performance.now() < (this.suppressClickUntil ?? 0)) return;
        this.move(Math.sign(card.position), true);
      });
    }
    this.root.querySelectorAll('.carousel-controls button').forEach(button => { button.disabled = this.images.length < 2; });
  }

  fill(card, index) {
    const item = this.images[index];
    card.element.dataset.framing = item.framing ?? '';
    card.img.src = item.src;
    card.img.alt = item.alt;
    card.img.loading = Math.abs(card.position) < 2 ? 'eager' : 'lazy';
    card.img.fetchPriority = card.position === 0 ? 'high' : 'auto';
    card.img.srcset = item.srcset || '';
    if (item.srcset) card.img.sizes = '(max-width: 767px) 86vw, min(74vw, 1216px)';
    card.reflected.src = item.src;
    card.element.setAttribute('aria-label', `${index + 1} de ${this.images.length}: ${item.title}`);
    card.button.setAttribute('aria-label', `Ver ${item.title}`);
  }

  position(card) {
    card.element.dataset.position = String(card.position);
    const offscreen = Math.abs(card.position) > 1;
    card.element.setAttribute('aria-hidden', String(offscreen));
    card.element.inert = offscreen;
    card.button.hidden = card.position === 0 || offscreen;
    card.button.tabIndex = offscreen || card.position === 0 ? -1 : 0;
  }

  move(direction, manual = false) {
    if (!direction || this.busy || this.images.length < 2) return;
    clearTimeout(this.timer);
    this.busy = true;
    direction = Math.sign(direction);
    this.index = modulo(this.index + direction, this.images.length);
    // Evita que el foco quede atrapado en una diapositiva que pasa a estar oculta.
    if (this.stage.contains(document.activeElement)) this.root.focus({ preventScroll: true });
    for (const card of this.cards) {
      card.position -= direction;
      this.position(card);
    }
    this.updateCaption(manual);
    const finish = () => {
      for (const card of this.cards) {
        if (Math.abs(card.position) <= 2) continue;
        card.element.classList.add('recycling');
        card.position = direction > 0 ? 2 : -2;
        this.fill(card, modulo(this.index + card.position, this.images.length));
        this.position(card);
        // La posición reciclada permanece invisible; la transición vuelve en el siguiente cuadro.
        card.element.getBoundingClientRect();
        card.element.classList.remove('recycling');
      }
      this.busy = false;
      this.schedule();
    };
    if (this.motion.matches || !this.duration) finish();
    else this.finishTimer = setTimeout(finish, this.duration + 35);
  }

  updateCaption(manual = false) {
    const item = this.images[this.index];
    this.root.querySelector('.slide-count').textContent = this.images.length ? `${String(this.index + 1).padStart(2, '0')} / ${String(this.images.length).padStart(2, '0')}` : '00 / 00';
    this.root.querySelector('.slide-title').textContent = item?.title ?? 'Próximamente';
    this.root.querySelector('.slide-description').textContent = item?.description ?? 'Fotografías oficiales pendientes';
    if (manual && item) this.root.querySelector('.carousel-status').textContent = `${this.index + 1} de ${this.images.length}: ${item.title}`;
  }

  schedule() {
    clearTimeout(this.timer);
    const stopped = this.paused || this.motion.matches;
    this.pauseButton.setAttribute('aria-label', this.motion.matches ? 'Reproducción automática desactivada por movimiento reducido' : this.paused ? 'Reanudar reproducción automática' : 'Pausar reproducción automática');
    this.pauseButton.querySelector('span').textContent = stopped ? '▷' : 'Ⅱ';
    this.pauseButton.disabled = this.motion.matches || this.images.length < 2;
    if (!stopped && !this.reasons.size && !this.busy && this.images.length > 1) this.timer = setTimeout(() => this.move(1), this.interval);
  }

  setReason(reason, active) {
    if (active) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.schedule();
  }

  bind() {
    this.on(this.root.querySelector('[data-carousel="previous"]'), 'click', () => this.move(-1, true));
    this.on(this.root.querySelector('[data-carousel="next"]'), 'click', () => this.move(1, true));
    this.on(this.pauseButton, 'click', () => { this.paused = !this.paused; this.schedule(); });
    // El ratón puede permanecer sobre la foto. Solo el foco de teclado pausa la reproducción.
    this.on(this.root, 'focusin', event => this.setReason('focus', event.target.matches(':focus-visible')));
    this.on(this.root, 'focusout', event => { if (!this.root.contains(event.relatedTarget)) this.setReason('focus', false); });
    this.on(document, 'visibilitychange', () => this.setReason('hidden', document.hidden));
    this.setReason('hidden', document.hidden);
    this.on(this.motion, 'change', () => this.schedule());
    this.on(this.root, 'keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.setReason('focus', true);
        this.move(event.key === 'ArrowRight' ? 1 : -1, true);
      }
    });
    this.on(this.stage, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || this.busy) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.setReason('drag', true);
    });
    this.on(window, 'pointerup', event => {
      if (event.pointerId !== this.drag?.id) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        this.suppressClickUntil = performance.now() + 400;
        this.move(dx < 0 ? 1 : -1, true);
      }
      this.drag = null;
      this.setReason('drag', false);
    });
    this.on(window, 'pointercancel', () => { this.drag = null; this.setReason('drag', false); });
    this.on(window, 'blur', () => {
      if (!this.drag) return;
      this.drag = null;
      this.setReason('drag', false);
    });
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(([entry]) => this.setReason('offscreen', !entry.isIntersecting), { threshold: .1 });
      this.observer.observe(this.root);
    }
  }

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.finishTimer);
    this.abort.abort();
    this.observer?.disconnect();
    this.stage.replaceChildren();
  }
}

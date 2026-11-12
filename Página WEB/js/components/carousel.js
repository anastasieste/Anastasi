const modulo = (value, length) => ((value % length) + length) % length;

export class CinematicCarousel {
  constructor(root, images, settings = {}) {
    this.root = root;
    this.images = images;
    this.interval = Math.max(1500, settings.interval ?? 4800);
    this.duration = Math.max(0, settings.duration ?? 850);
    this.index = 0;
    this.busy = false;
    this.resumeAt = 0;
    this.reasons = new Set();
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.abort = new AbortController();
    this.cards = [];
    this.stage = root.querySelector('.carousel-stage');
    this.arrows = [...this.stage.querySelectorAll('.carousel-arrow')];
    root.style.setProperty('--transition', `${this.duration}ms`);
    this.build();
    this.bind();
    this.schedule();
  }

  on(element, event, handler, options = {}) {
    element.addEventListener(event, handler, { ...options, signal: this.abort.signal });
  }

  build() {
    // Empieza por el centro y recicla las mismas tarjetas, incluso con una sola foto.
    const positions = this.images.length ? [0, 1, -1, 2, -2] : [];
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
      reflected.loading = 'lazy';
      reflected.fetchPriority = 'low';
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
    this.root.hidden = !this.images.length;
    this.arrows.forEach(button => { button.hidden = !this.images.length; });
  }

  fill(card, index) {
    const item = this.images[index];
    card.img.alt = item.alt;
    card.img.loading = Math.abs(card.position) < 2 ? 'eager' : 'lazy';
    card.img.fetchPriority = card.position === 0 ? 'high' : 'auto';
    if (card.img.getAttribute('src') !== item.src) {
      card.img.src = item.src;
      card.reflected.src = item.src;
    }
  }

  position(card) {
    card.element.dataset.position = String(card.position);
    const offscreen = Math.abs(card.position) > 1;
    card.element.setAttribute('aria-hidden', String(offscreen));
    card.element.inert = offscreen;
    card.button.hidden = card.position === 0 || offscreen;
    card.button.tabIndex = offscreen || card.position === 0 ? -1 : 0;
    card.button.setAttribute('aria-label', card.position < 0 ? 'Ver fotografía anterior' : 'Ver fotografía siguiente');
  }

  move(direction, manual = false) {
    if (!direction || this.busy || !this.images.length) return;
    clearTimeout(this.timer);
    this.busy = true;
    direction = Math.sign(direction);
    this.index = modulo(this.index + direction, this.images.length);
    // Evita que el foco quede atrapado en una diapositiva que pasa a estar oculta.
    if (this.cards.some(card => card.button === document.activeElement)) this.root.focus({ preventScroll: true });
    for (const card of this.cards) {
      card.position -= direction;
      this.position(card);
    }
    if (manual) this.root.querySelector('.carousel-status').textContent = this.images[this.index].alt;
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

  schedule() {
    clearTimeout(this.timer);
    if (this.motion.matches || this.reasons.size || this.busy || !this.images.length) return;
    const delay = this.resumeAt ? Math.max(0, this.resumeAt - performance.now()) : this.interval;
    this.timer = setTimeout(() => {
      this.resumeAt = 0;
      this.move(1);
    }, delay);
  }

  setReason(reason, active) {
    if (active) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.schedule();
  }

  resumeAfterInteraction(reason) {
    this.resumeAt = performance.now() + 3000;
    this.setReason(reason, false);
  }

  bind() {
    for (const button of this.arrows) {
      this.on(button, 'click', () => this.move(button.dataset.carousel === 'previous' ? -1 : 1, true));
      this.on(button, 'pointerenter', event => { if (event.pointerType === 'mouse') this.setReason(button, true); });
      this.on(button, 'pointerleave', event => { if (event.pointerType === 'mouse') this.resumeAfterInteraction(button); });
    }
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
      if (!event.isPrimary || event.pointerType !== 'touch' || event.button !== 0 || !this.images.length) return;
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
      this.resumeAfterInteraction('drag');
    });
    this.on(window, 'pointercancel', event => {
      if (event.pointerId !== this.drag?.id) return;
      this.drag = null;
      this.resumeAfterInteraction('drag');
    });
    this.on(window, 'blur', () => {
      if (!this.drag) return;
      this.drag = null;
      this.resumeAfterInteraction('drag');
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
    this.cards.forEach(card => card.element.remove());
  }
}

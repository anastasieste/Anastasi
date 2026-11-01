function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function renderSquads(root, squads) {
  if (!squads.length) return;
  root.replaceChildren();
  root.classList.add('has-content');
  for (const squad of squads) {
    const card = node('article', '', 'squad-card');
    if (squad.badge || squad.photo) {
      const img = node('img');
      img.src = squad.badge || squad.photo;
      img.alt = `Insignia o fotografía de ${squad.name}`;
      img.loading = 'lazy';
      card.append(img);
    }
    card.append(node('span', squad.code, 'eyebrow'), node('h3', squad.name), node('p', squad.description));
    if (squad.members?.length) card.append(node('p', squad.members.map(member => member.callsign).join(' · ')));
    root.append(card);
  }
}

export function setupGallery(items) {
  const root = document.querySelector('#gallery-list');
  const emptyTemplate = root.firstElementChild.cloneNode(true);
  const dialog = document.querySelector('#media-dialog');
  const content = dialog.querySelector('.media-content');
  const approvedItems = items.filter(item => item.approved === true);
  function render(filter) {
    const visible = approvedItems.filter(item => filter === 'all' || item.type === filter);
    root.replaceChildren();
    root.classList.toggle('has-content', visible.length > 0);
    document.querySelector('#gallery-count').textContent = `${visible.length} ${visible.length === 1 ? 'publicación' : 'publicaciones'}`;
    if (!visible.length) {
      const empty = emptyTemplate.cloneNode(true);
      if (filter !== 'all') empty.querySelector('h3').textContent = filter === 'photo' ? 'Las fotografías están por llegar.' : 'Los videos están por llegar.';
      root.append(empty);
      return;
    }
    for (const item of visible) {
      const card = node('button', '', 'media-card');
      card.type = 'button';
      card.setAttribute('aria-label', `Abrir ${item.type === 'video' ? 'video' : 'fotografía'}: ${item.title}`);
      if (item.thumbnail || item.type === 'photo') {
        const image = node('img');
        image.src = item.thumbnail || item.src;
        image.alt = item.alt || item.title;
        image.loading = 'lazy';
        image.width = 640;
        image.height = 360;
        card.append(image);
      }
      const date = item.publishedAt ? new Date(`${item.publishedAt}T12:00:00`).toLocaleDateString('es-PR') : '';
      card.append(node('h3', item.title), node('p', [item.callsign, item.squad, date].filter(Boolean).join(' · ')));
      card.addEventListener('click', () => {
        content.replaceChildren();
        const media = node(item.type === 'video' ? 'video' : 'img');
        media.src = item.src;
        if (item.type === 'video') {
          media.controls = true;
          media.preload = 'metadata';
          media.playsInline = true;
          if (item.thumbnail) media.poster = item.thumbnail;
        } else media.alt = item.alt || item.title;
        content.append(media, node('p', item.title));
        dialog.showModal();
      });
      root.append(card);
    }
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    render(button.dataset.filter);
  }));
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { content.querySelector('video')?.pause(); content.replaceChildren(); });
  render('all');
}

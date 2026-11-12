import { captureVideoCover } from '../video-cover.js';

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
    card.append(node('h3', squad.name || squad.code), node('p', squad.description));
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
  let publishedVideos = [];
  let filter = 'all';
  const coverSources = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      observer.unobserve(image);
      const source = image.dataset.video;
      let cover = coverSources.get(source);
      if (!cover) {
        cover = captureVideoCover(source, true);
        coverSources.set(source, cover);
        cover.then(value => { if (!value) coverSources.delete(source); });
      }
      cover.then(value => { if (value && image.isConnected) image.src = value; });
    }
  }, { rootMargin: '150px' });
  function render(filter) {
    const visible = [...publishedVideos, ...approvedItems].filter(item => filter === 'all' || item.type === filter);
    observer.disconnect();
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
      const isVideo = item.type === 'video';
      const card = node('button', '', isVideo ? 'media-card media-card-video' : 'media-card');
      card.type = 'button';
      card.setAttribute('aria-label', isVideo ? `Abrir video: ${item.title}` : `Abrir fotografía: ${item.alt}`);
      if (isVideo || item.thumbnail || item.type === 'photo') {
        const image = node('img');
        image.alt = isVideo ? '' : item.alt;
        image.loading = 'lazy';
        image.width = 640;
        image.height = 360;
        card.append(image);
        if (isVideo) {
          image.dataset.video = item.src;
          if (item.thumbnail) {
            image.addEventListener('error', () => {
              image.removeAttribute('src');
              if (image.isConnected) observer.observe(image);
            }, { once: true });
            image.src = item.thumbnail;
          } else observer.observe(image);
        } else image.src = item.thumbnail || item.src;
      }
      if (isVideo) card.append(node('h3', item.title));
      card.addEventListener('click', () => {
        content.replaceChildren();
        const media = node(item.type === 'video' ? 'video' : 'img');
        media.src = item.src;
        if (item.type === 'video') {
          media.controls = true;
          media.preload = 'metadata';
          media.playsInline = true;
          const poster = card.querySelector('img')?.getAttribute('src');
          if (poster) media.poster = poster;
        } else media.alt = item.alt;
        content.append(media);
        if (isVideo) content.append(node('p', item.title));
        dialog.showModal();
      });
      root.append(card);
    }
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    filter = button.dataset.filter;
    render(filter);
  }));
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { content.querySelector('video')?.pause(); content.replaceChildren(); });
  render('all');
  return videos => {
    if (JSON.stringify(videos) === JSON.stringify(publishedVideos)) return;
    publishedVideos = videos;
    render(filter);
  };
}

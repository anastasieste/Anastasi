import { account } from './account.js?v=1.14';
import { reviewOutro, uploadContent } from './content-transfer.js?v=1.14';
import { captureVideoCover } from './video-cover.js';
import { maxSourceDuration } from './video-timeline.js';

const types = new Map([
  ['mp4', 'video/mp4'], ['mov', 'video/quicktime'], ['webm', 'video/webm'],
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
]);

export function setupContentUpload() {
  const byId = id => document.getElementById('content-' + id);
  const input = byId('file');
  const drop = byId('drop');
  const pick = byId('pick');
  const remove = byId('remove');
  const photo = byId('photo');
  const video = byId('video');
  const status = byId('status');
  const progress = byId('progress');
  const send = byId('submit');
  const dialog = byId('confirm');
  const form = dialog.querySelector('form');
  const titleInput = form.elements.title;
  const notice = byId('notice');
  let selection;
  let sourceUrl;
  let busy = false;
  let preparing = false;

  function message(text, error = false) {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
  }

  function controls() {
    send.disabled = busy || preparing || !selection?.ready;
    remove.disabled = pick.disabled = busy || preparing;
  }

  function clear() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    photo.removeAttribute('src');
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    selection = sourceUrl = undefined;
    byId('selection').hidden = photo.hidden = video.hidden = true;
    progress.hidden = true;
    controls();
  }

  function select(file) {
    if (!file || busy || preparing) return;
    clear();
    const mime = types.get(file.name.split('.').at(-1).toLowerCase());
    const isVideo = mime?.startsWith('video/');
    if (!mime || !file.size || (!isVideo && file.size > 10 * 1024 * 1024)) {
      message('Elige un MP4, MOV o WebM, o una foto JPG, PNG o WebP de hasta 10 MB.', true);
      return;
    }
    selection = { file, mime, isVideo, ready: false, title: '', transfer: {} };
    sourceUrl = URL.createObjectURL(file);
    byId('selection').hidden = false;
    byId('name').textContent = file.name;
    const player = isVideo ? video : photo;
    player.hidden = false;
    player.src = sourceUrl;
    message('Cargando vista previa…');
  }

  function previewReady(player) {
    if (!selection || player.src !== sourceUrl || selection.isVideo !== (player === video)) return;
    if (player === video && (!Number.isFinite(video.duration) || !video.videoHeight || video.duration * 1000 > maxSourceDuration)) {
      clear();
      message('Selecciona un video de hasta 20 minutos que se pueda reproducir en tu navegador.', true);
      return;
    }
    selection.ready = true;
    message('');
    controls();
  }

  photo.addEventListener('load', () => previewReady(photo));
  video.addEventListener('loadedmetadata', () => previewReady(video));
  for (const player of [photo, video]) player.addEventListener('error', () => {
    if (!selection || player.src !== sourceUrl || selection.isVideo !== (player === video)) return;
    clear();
    message('No se pudo abrir el archivo. Prueba con un MP4, JPG, PNG o WebP compatible.', true);
  });
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { select(input.files[0]); input.value = ''; });
  remove.addEventListener('click', () => { clear(); message(''); pick.focus(); });
  drop.addEventListener('dragover', event => {
    event.preventDefault();
    if (!busy && !preparing) drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    select(event.dataTransfer.files[0]);
  });

  send.addEventListener('click', async () => {
    if (send.disabled) return;
    preparing = true;
    video.pause();
    controls();
    try {
      notice.hidden = !await account.videoNotice().catch(() => true);
      form.elements.skip_notice.checked = false;
      titleInput.setCustomValidity('');
      titleInput.value = selection.title || selection.file.name.replace(/\.[^.]+$/, '').slice(0, 100);
      dialog.showModal();
      titleInput.select();
    } finally {
      preparing = false;
      controls();
    }
  });
  byId('cancel').addEventListener('click', () => dialog.close());
  titleInput.addEventListener('input', () => titleInput.setCustomValidity(''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selection?.ready) return;
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.setCustomValidity('Escribe un título.');
      titleInput.reportValidity();
      return;
    }
    const entry = selection;
    if (entry.title !== title && entry.transfer.id) entry.transfer = { cover: entry.transfer.cover };
    entry.title = title;
    busy = true;
    dialog.close();
    controls();
    try {
      if (!notice.hidden && form.elements.skip_notice.checked) await account.videoNotice(false).catch(() => {});
      if (entry.isVideo && !entry.output) {
        message('Cargando el cierre de Anástasi…');
        const outro = await reviewOutro();
        const { renderVideo } = await import('./video-render.js?v=1.14');
        const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
        const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
        const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
        entry.output = await renderVideo(entry.file, [[0, video.duration * 1000]], height, message, { outro, width });
      }
      if (entry.isVideo && !('cover' in entry.transfer)) {
        message('Preparando carátula…');
        const url = URL.createObjectURL(entry.output);
        try { entry.transfer.cover = await captureVideoCover(url); }
        finally { URL.revokeObjectURL(url); }
      }
      const payload = entry.output || entry.file.slice(0, entry.file.size, entry.mime);
      progress.value = 0;
      progress.hidden = false;
      message('Subiendo archivo…');
      await uploadContent(payload, title, entry.transfer, percent => {
        progress.value = percent;
        message(`Subiendo archivo… ${percent} %`);
      });
      clear();
      message('Enviado. Pendiente de revisión.');
    } catch (error) {
      message(error.message || 'No se pudo enviar el archivo. Intenta nuevamente.', true);
    } finally {
      busy = false;
      controls();
    }
  });
  window.addEventListener('beforeunload', event => { if (busy) event.preventDefault(); });
}

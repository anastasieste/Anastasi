import { account, formMessage } from './account.js';
import { defaultAfter, defaultBefore, formatTime, maxSourceDuration, mergedRanges, parseTime, validEvent } from './video-timeline.js';

const byId = id => document.getElementById(id);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function upload(blob, title, state, onProgress) {
  if (!state.id) Object.assign(state, await account.videoStart(title, blob.size));
  let result = { received: state.received || 0 };
  let attempts = 0;
  while (!result.submitted) {
    const offset = result.received;
    try {
      result = offset < blob.size
        ? await account.videoChunk(state.id, blob.slice(offset, offset + state.chunkSize), offset)
        : await account.videoOffset(state.id);
      if (!result.submitted && (!Number.isInteger(result.received) || result.received <= offset || result.received > blob.size)) {
        throw new Error('La subida no avanzó.');
      }
      attempts = 0;
    } catch (error) {
      if (error.status && error.status < 500 && error.status !== 429) {
        if (error.status === 410) { delete state.id; delete state.received; }
        throw error;
      }
      if (++attempts > 3) throw error;
      await pause(700 * attempts);
      try {
        const status = await account.videoOffset(state.id);
        if (status.submitted || (Number.isInteger(status.received) && status.received >= 0 && status.received <= blob.size)) result = status;
      } catch (failure) {
        if (failure.status === 410) { delete state.id; delete state.received; throw failure; }
      }
    }
    state.received = result.received;
    onProgress(Math.floor(result.received * 100 / blob.size));
  }
}

export function setupEditor(profile) {
  const player = byId('editor-player');
  const fileInput = byId('video-file');
  const titleInput = byId('video-title');
  const form = byId('video-event-form');
  const fields = form.elements;
  const fieldset = form.querySelector('fieldset');
  const list = byId('video-events');
  const track = byId('video-track');
  const status = byId('video-status');
  const progress = byId('video-progress');
  const publish = byId('video-submit');
  const download = byId('video-export');
  const add = byId('video-new');
  const remove = byId('video-remove');
  const notice = byId('video-notice');
  const noticeSkip = byId('video-notice-skip');
  const draftKey = 'anastasi.editor.draft.' + profile.callsign;
  let file, sourceUrl, duration = 0, events = [], selected, busy = false, cached, submitted = false, submitting = false;
  let transfer = {};
  let ranges = [];

  function message(text, error = false) {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
  }
  function signature() {
    return file ? [file.name, file.size, file.lastModified].join('|') : '';
  }
  function saveDraft() {
    if (!duration) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ source: signature(), events, title: titleInput.value })); }
    catch { /* El almacenamiento local es opcional. */ }
  }
  function draft() {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey));
      if (value?.source === signature() && Array.isArray(value.events)) return value;
    } catch { /* Un borrador inválido se descarta. */ }
    return null;
  }
  function renderCursor() {
    const marker = track.querySelector('.video-cursor');
    if (marker && duration) marker.style.left = Math.min(99.5, player.currentTime * 100000 / duration) + '%';
  }
  function controls() {
    fileInput.disabled = titleInput.disabled = busy;
    add.disabled = fieldset.disabled = busy || !duration;
    download.disabled = busy || !ranges.length;
    publish.disabled = busy || submitting || submitted || !ranges.length || !titleInput.value.trim();
    list.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  }
  function trackEvents() {
    ranges = mergedRanges(events, duration);
    track.replaceChildren();
    for (const [start, end] of ranges) {
      const clip = document.createElement('span');
      clip.style.left = start * 100 / duration + '%';
      clip.style.width = (end - start) * 100 / duration + '%';
      track.append(clip);
    }
    if (duration) {
      const marker = document.createElement('span');
      marker.className = 'video-cursor';
      track.append(marker);
      renderCursor();
    }
    const total = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
    byId('video-summary').textContent = ranges.length + (ranges.length === 1 ? ' clip' : ' clips') + (total ? ' · ' + formatTime(total) : '');
    controls();
  }
  function eventType() {
    const combat = fields.type.value === 'Combate';
    const other = fields.type.value === 'Otro';
    byId('video-end').hidden = byId('video-mark-end').hidden = !combat;
    byId('video-other').hidden = !other;
    fields.end.required = combat;
    fields.name.required = other;
  }
  function drawEvents() {
    list.replaceChildren();
    for (const item of events) {
      const entry = document.createElement('li');
      const button = document.createElement('button');
      const label = document.createElement('span');
      const time = document.createElement('time');
      button.type = 'button';
      button.className = 'account-submit';
      button.setAttribute('aria-pressed', String(selected === item.id));
      label.textContent = item.type === 'Otro' ? item.name : item.type;
      time.textContent = formatTime(item.start) + (item.type === 'Combate' ? ' – ' + formatTime(item.end) : '');
      button.append(label, time);
      button.addEventListener('click', () => {
        player.pause();
        player.currentTime = item.start / 1000;
        edit(item);
        list.querySelector('[aria-pressed=true]')?.focus();
      });
      entry.append(button);
      list.append(entry);
    }
  }
  function edit(item) {
    selected = item?.id;
    fields.type.value = item?.type ?? 'Kill';
    fields.start.value = duration ? formatTime(item?.start ?? player.currentTime * 1000) : '';
    fields.end.value = item?.type === 'Combate' ? formatTime(item.end) : '';
    fields.name.value = item?.name ?? '';
    fields.before.value = item?.before ?? defaultBefore;
    fields.after.value = item?.after ?? defaultAfter;
    byId('video-save').textContent = item ? 'Guardar evento' : 'Añadir evento';
    remove.hidden = !item;
    eventType();
    drawEvents();
    trackEvents();
    formMessage(form, '');
  }
  function changed(reencode = true) {
    if (reencode) cached = undefined;
    submitted = false;
    transfer = {};
    progress.hidden = true;
    saveDraft();
    message('');
    controls();
  }
  function clearSource() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    player.removeAttribute('src');
    player.load();
    file = sourceUrl = undefined;
    duration = 0;
    events = [];
    titleInput.value = '';
    byId('video-source-name').textContent = 'Duración máxima: 20 minutos';
    edit();
    changed();
  }
  fileInput.addEventListener('change', () => {
    const input = fileInput.files[0];
    fileInput.value = '';
    if (!input || (file && input.name === file.name && input.size === file.size && input.lastModified === file.lastModified)) return;
    clearSource();
    file = input;
    sourceUrl = URL.createObjectURL(file);
    byId('video-source-name').textContent = file.name;
    player.src = sourceUrl;
  });
  player.addEventListener('loadedmetadata', () => {
    if (!file) return;
    const length = Math.ceil(player.duration * 1000);
    if (!Number.isFinite(length) || !length || length > maxSourceDuration) {
      clearSource();
      message('Selecciona un video que dure hasta 20 minutos.', true);
      return;
    }
    duration = length;
    const saved = draft();
    events = saved?.events.filter(item => item?.id && validEvent(item, duration)) ?? [];
    titleInput.value = saved?.title ?? file.name.replace(/\.[^.]+$/, '').slice(0, 100);
    edit();
    if (saved && events.length) message('Borrador recuperado.');
  });
  player.addEventListener('error', () => {
    if (!file) return;
    clearSource();
    message('El navegador no pudo abrir el video. Prueba con un MP4 compatible.', true);
  });
  player.addEventListener('timeupdate', renderCursor);
  fields.type.addEventListener('change', eventType);
  byId('video-mark-start').addEventListener('click', () => { fields.start.value = formatTime(player.currentTime * 1000); });
  byId('video-mark-end').addEventListener('click', () => { fields.end.value = formatTime(player.currentTime * 1000); });
  add.addEventListener('click', () => { edit(); fields.type.focus(); });
  remove.addEventListener('click', () => {
    events = events.filter(item => item.id !== selected);
    changed();
    edit();
    add.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !duration) return;
    const type = fields.type.value;
    const start = parseTime(fields.start.value);
    const item = {
      id: selected || crypto.randomUUID(), type, start, end: type === 'Combate' ? parseTime(fields.end.value) : start,
      name: fields.name.value.trim(), before: Number(fields.before.value), after: Number(fields.after.value),
    };
    if (!validEvent(item, duration)) {
      formMessage(form, 'Verifica los tiempos y los márgenes. El fin de un combate debe ir después del inicio.', true);
      return;
    }
    events = [...events.filter(entry => entry.id !== item.id), item].sort((a, b) => a.start - b.start);
    changed();
    edit(item);
    formMessage(form, 'Evento guardado.');
  });
  titleInput.addEventListener('input', () => changed(false));

  async function exportMontage(send) {
    if (!file || !ranges.length || busy || (send && submitted)) return;
    busy = true;
    player.pause();
    progress.hidden = true;
    controls();
    try {
      if (!cached) {
        message('Preparando video…');
        const { renderVideo } = await import('./video-render.js');
        const height = Math.max(2, Math.floor(Math.min(720, player.videoHeight) / 2) * 2);
        cached = await renderVideo(file, ranges, height, message);
      }
      const title = titleInput.value.trim() || 'Montaje de Anástasi';
      if (send) {
        progress.value = 0;
        progress.hidden = false;
        message('Subiendo video…');
        await upload(cached, title, transfer, percent => {
          progress.value = percent;
          message('Subiendo video… ' + percent + ' %');
        });
        submitted = true;
        message('Enviado a revisión.');
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(cached);
        link.download = title + '.mp4';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 60000);
        message('MP4 listo.');
      }
    } catch (error) {
      message(error.message || 'No se pudo preparar el video.', true);
    } finally {
      busy = false;
      controls();
    }
  }
  download.addEventListener('click', () => exportMontage(false));
  publish.addEventListener('click', async () => {
    submitting = true;
    controls();
    try {
      if (transfer.id || !await account.videoNotice()) await exportMontage(true);
      else {
        noticeSkip.checked = false;
        notice.showModal();
      }
    } catch (error) { message(error.message, true); }
    finally { submitting = false; controls(); }
  });
  byId('video-notice-cancel').addEventListener('click', () => notice.close());
  byId('video-notice-confirm').addEventListener('click', async () => {
    notice.close();
    if (noticeSkip.checked) await account.videoNotice(false).catch(() => {});
    await exportMontage(true);
  });
  window.addEventListener('beforeunload', event => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

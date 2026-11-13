import { account } from './account.js?v=1.14';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function reviewOutro() {
  const outro = await account.videoOutro();
  if (outro.type !== 'video/mp4' || !outro.size) throw new Error('El video de cierre no está disponible. Intenta nuevamente.');
  return outro;
}

export async function uploadContent(blob, title, state, onProgress) {
  if (!state.id) Object.assign(state, await account.videoStart(title, blob.size, state.cover, blob.type));
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

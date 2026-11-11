function waitForVideo(video, type, signal, start) {
  return new Promise((resolve, reject) => {
    const events = new AbortController();
    function finish(error) {
      events.abort();
      signal.removeEventListener('abort', expired);
      if (error) reject(error);
      else resolve();
    }
    function expired() { finish(signal.reason); }
    if (signal.aborted) { expired(); return; }
    signal.addEventListener('abort', expired, { once: true });
    video.addEventListener(type, () => finish(), { signal: events.signal });
    video.addEventListener('error', () => finish(new Error('No se pudo leer el fotograma.')), { signal: events.signal });
    start();
  });
}

export async function captureVideoCover(src, remote = false) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (remote) video.crossOrigin = 'anonymous';
  const signal = AbortSignal.timeout(8000);
  let first = null;
  try {
    await waitForVideo(video, 'loadeddata', signal, () => { video.src = src; });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 480 / video.videoWidth, 360 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    for (const time of [0, .25, .5, 1, 2, 3]) {
      if (time >= video.duration) break;
      if (time) await waitForVideo(video, 'seeked', signal, () => { video.currentTime = time; });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      let image = canvas.toDataURL('image/jpeg', .72);
      if (image.length > 80023) image = canvas.toDataURL('image/jpeg', .5);
      if (image.length > 80023) continue;
      first ??= image;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let visible = 0;
      for (let i = 0; i < data.length; i += 64) {
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 32) visible++;
      }
      if (visible > data.length / 64 * .02) return image;
    }
  } catch {
    // Conserva el primer fotograma disponible si el navegador interrumpe la lectura.
  } finally {
    video.removeAttribute('src');
    video.load();
  }
  return first;
}

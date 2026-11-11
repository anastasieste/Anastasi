// Exportador web basado en BAT Montaje. El motor se carga cuando se solicita el MP4.
import { maxMontageBytes } from './video-timeline.js';

export async function renderVideo(file, ranges, height, onStatus) {
  const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
  const ffmpeg = new FFmpeg();
  const url = name => new URL('../vendor/core/' + name, import.meta.url).href;
  const totalSeconds = ranges.reduce((sum, [start, end]) => sum + (end - start) / 1000, 0);
  // Margen para el audio y el contenedor. El límite también se valida en el resultado.
  const videoKbps = Math.max(160, Math.min(2000, Math.floor(maxMontageBytes * 8 * .9 / (totalSeconds * 1000) - 96)));
  try {
    onStatus('Cargando el motor de video…');
    await ffmpeg.load({ coreURL: url('ffmpeg-core.js'), wasmURL: url('ffmpeg-core.wasm') });
    // Montar el File evita copiar el video fuente completo al sistema de archivos en memoria.
    await ffmpeg.createDir('/source');
    if (!await ffmpeg.mount('WORKERFS', { blobs: [{ name: 'input', data: file }] }, '/source')) {
      throw new Error('No se pudo preparar el video para exportar.');
    }
    const parts = [];
    for (const [start, end] of ranges) {
      const part = 'clip-' + parts.length + '.mp4';
      onStatus(`Preparando video · clip ${parts.length + 1} de ${ranges.length}…`);
      const result = await ffmpeg.exec([
        '-ss', (start / 1000).toFixed(3), '-i', '/source/input', '-t', ((end - start) / 1000).toFixed(3),
        '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', `scale=-2:${height},fps=30`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', '24',
        '-maxrate', videoKbps + 'k', '-bufsize', videoKbps * 2 + 'k',
        '-c:a', 'aac', '-b:a', '96k', part,
      ]);
      if (result !== 0) throw new Error('No se pudo preparar un clip. Prueba con un video más corto.');
      parts.push(part);
    }
    await ffmpeg.writeFile('clips.txt', new TextEncoder().encode(parts.map(part => `file '${part}'`).join('\n')));
    onStatus('Uniendo clips…');
    if (await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-c', 'copy', '-movflags', '+faststart', 'final.mp4']) !== 0) {
      throw new Error('No se pudieron unir los clips.');
    }
    const data = await ffmpeg.readFile('final.mp4');
    if (!(data instanceof Uint8Array) || !data.length || data.length > maxMontageBytes) {
      throw new Error('El montaje supera 100 MB o está incompleto. Reduce la duración de los recortes.');
    }
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    ffmpeg.terminate();
  }
}

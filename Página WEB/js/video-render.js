// Exportador web basado en BAT Montaje. El motor se carga cuando se solicita el MP4.
import { maxMontageBytes } from './video-timeline.js';

async function inspect(ffmpeg, file, output) {
  await ffmpeg.ffprobe([
    '-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file, '-o', output,
  ]);
  // Esta versión del motor puede devolver -1 aunque haya escrito el informe.
  const report = await ffmpeg.readFile(output, 'utf8').then(JSON.parse).catch(() => null);
  if (!report) throw new Error('No se pudo leer el formato de uno de los videos.');
  const { streams, format } = report;
  if (!streams?.some(stream => stream.codec_type === 'video')) throw new Error('Uno de los archivos no contiene una pista de video.');
  return { audio: streams.some(stream => stream.codec_type === 'audio'), duration: Number(format?.duration) };
}

export async function renderVideo(file, ranges, height, onStatus, { outro, width } = {}) {
  const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
  const ffmpeg = new FFmpeg();
  const url = name => new URL('../vendor/core/' + name, import.meta.url).href;
  try {
    onStatus('Cargando el motor de video…');
    await ffmpeg.load({ coreURL: url('ffmpeg-core.js'), wasmURL: url('ffmpeg-core.wasm') });
    // Montar el File evita copiar el video fuente completo al sistema de archivos en memoria.
    await ffmpeg.createDir('/source');
    const blobs = [{ name: 'input', data: file }];
    if (outro) blobs.push({ name: 'outro.mp4', data: outro });
    if (!await ffmpeg.mount('WORKERFS', { blobs }, '/source')) {
      throw new Error('No se pudo preparar el video para exportar.');
    }
    const source = '/source/input';
    const ending = '/source/outro.mp4';
    const segments = ranges.map(([start, end]) => ({ source, start: start / 1000, seconds: (end - start) / 1000 }));
    const audio = new Map();
    let filter = `scale=-2:${height},fps=30`;
    if (outro) {
      const main = await inspect(ffmpeg, source, 'input.json');
      const closing = await inspect(ffmpeg, ending, 'outro.json');
      if (!Number.isFinite(closing.duration) || closing.duration <= 0) throw new Error('No se pudo leer la duración del video de cierre.');
      audio.set(source, main.audio);
      audio.set(ending, closing.audio);
      segments.push({ source: ending, start: 0, seconds: closing.duration });
      // Igualar el tamaño y las pistas permite unir los segmentos sin recodificar el montaje final.
      filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
    }
    const totalSeconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
    const videoKbps = Math.max(160, Math.min(2000, Math.floor(maxMontageBytes * 8 * .9 / (totalSeconds * 1000) - 96)));
    const parts = [];
    for (const segment of segments) {
      const part = 'clip-' + parts.length + '.mp4';
      const isOutro = segment.source === ending;
      onStatus(isOutro ? 'Añadiendo el cierre de Anástasi…' : `Preparando video · clip ${parts.length + 1} de ${ranges.length}…`);
      const silent = outro && !audio.get(segment.source);
      const result = await ffmpeg.exec([
        '-ss', segment.start.toFixed(3), '-i', segment.source,
        ...(silent ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'] : []),
        '-t', segment.seconds.toFixed(3), '-map', '0:v:0', '-map', silent ? '1:a:0' : '0:a:0?',
        '-sn', '-dn', '-vf', filter,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', '24',
        '-maxrate', videoKbps + 'k', '-bufsize', videoKbps * 2 + 'k',
        '-c:a', 'aac', '-b:a', '96k',
        ...(outro ? ['-ar', '48000', '-ac', '2', '-af', 'apad', '-shortest'] : []),
        part,
      ]);
      if (result !== 0) throw new Error(isOutro ? 'No se pudo añadir el video de cierre.' : 'No se pudo preparar un clip. Prueba con un video más corto.');
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

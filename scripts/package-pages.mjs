import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'Página WEB');
const target = path.join(root, 'dist');
const modules = process.env.ANASTASI_FFMPEG_MODULES || path.join(root, 'node_modules');
// Solo se reemplaza la carpeta de salida controlada por este script.
if (path.dirname(target) !== path.resolve(root) || path.basename(target) !== 'dist') throw new Error('Ruta de salida no válida.');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of ['index.html', 'registro.html', 'restablecer.html', 'correo.html', 'perfil.html', 'miembros.html', 'editor.html', 'subir.html', 'gestion.html',
  'solicitudes.html', 'css', 'js', 'assets', 'manifest.webmanifest', 'sw.js', '.nojekyll']) {
  await cp(path.join(source, file), path.join(target, file), { recursive: true });
}
for (const [name, files] of [
  ['ffmpeg', ['index.js', 'classes.js', 'const.js', 'errors.js', 'utils.js', 'types.js', 'worker.js']],
  ['core', ['ffmpeg-core.js', 'ffmpeg-core.wasm']],
]) {
  const vendor = path.join(target, 'vendor', name);
  await mkdir(vendor, { recursive: true });
  for (const file of files) await cp(path.join(modules, '@ffmpeg', name, 'dist', 'esm', file), path.join(vendor, file));
}
console.log('Sitio preparado en dist/. Las referencias de diseño no se incluyen.');

import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'Página WEB');
const target = path.join(root, 'dist');
// Solo se reemplaza la carpeta de salida controlada por este script.
if (path.dirname(target) !== path.resolve(root) || path.basename(target) !== 'dist') throw new Error('Ruta de salida no válida.');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of ['index.html', 'registro.html', 'restablecer.html', 'correo.html', 'perfil.html', 'miembros.html', 'editor.html',
  'solicitudes.html', 'css', 'js', 'assets', 'manifest.webmanifest', 'sw.js', '.nojekyll']) {
  await cp(path.join(source, file), path.join(target, file), { recursive: true });
}
console.log('Sitio preparado en dist/. Las referencias de diseño no se incluyen.');

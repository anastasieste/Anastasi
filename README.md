# Anástasi — Plataforma web v1.0

**Sitio publicado:** [anastasieste.github.io/Anastasi](https://anastasieste.github.io/Anastasi/) · Publicación inicial: 1 de noviembre de 2026.

Sitio público de la comunidad de airsoft Anástasi, Puerto Rico. Una primera versión ligera en español con identidad terracota, blanco cálido y negro, carrusel cinematográfico y fundamentos PWA. Sin frameworks, dependencias de producción ni servicios de pago.

## Ejecutar localmente

Con Python 3 instalado, abre una terminal en esta carpeta:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Abre <http://127.0.0.1:4173/P%C3%A1gina%20WEB/>. No abras `index.html` mediante doble clic: los módulos JavaScript necesitan HTTP. Detén el servidor con Ctrl+C.

## Archivos

```text
Página WEB/
  index.html                  Contenido, navegación y secciones
  css/styles.css              Diseño responsive y variables visuales
  js/app.js                   Inicialización, menú y navegación
  js/components/carousel.js   Carrusel reutilizable
  js/components/collections.js  Escuadrones y galería
  js/data/content.js          Datos y configuración
  assets/images/branding/Chango2.png  Copia exacta del logo recibido
  assets/images/carousel/    Retrato provisional y futuras fotos
  assets/images/gallery/     Contenido público aprobado
  assets/images/squads/      Insignias y fotografías de escuadrones
  assets/icons/              Iconos PWA derivados, sin recorte del escudo
  manifest.webmanifest       Metadatos de instalación
  sw.js                      Caché mínima de la estructura
scripts/package-pages.mjs     Prepara dist/ con los archivos publicables
tests/carousel.html           Pruebas del componente en navegador
.github/workflows/pages.yml   Publicación con GitHub Actions
```

Los originales de referencia PNG y PSD permanecen intactos. No se publican en `dist/`. `Editor/` permanece reservado para una fase posterior. El proyecto no utiliza BAT Montaje.

## Publicar en GitHub Pages

1. Crea o utiliza el repositorio **Anastasi** y sube esta estructura completa a su rama `main`. La carpeta `.github` debe quedar en la raíz del repositorio, junto a `Página WEB`.
2. En el repositorio, abre **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Ejecuta el flujo **Publicar Anástasi en GitHub Pages**, o realiza un cambio en `Página WEB` y súbelo a `main`.
4. El flujo prepara `dist/` y publica únicamente el sitio. La URL aparece en el despliegue de GitHub Pages; normalmente tiene la forma `https://USUARIO.github.io/Anastasi/`.

La configuración sigue la [documentación oficial de flujos de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). GitHub Free permite Pages en repositorios públicos. No es necesario contratar un servicio. Si tu rama tiene otro nombre, ajusta `branches` en el flujo.

Todas las rutas del sitio son relativas y el manifest y Service Worker están limitados a la subruta del sitio. También puedes ejecutar `node scripts/package-pages.mjs` y servir `dist/` con cualquier servidor estático. El script reemplaza exclusivamente esa carpeta de salida.

Repositorio oficial: [anastasieste/Anastasi](https://github.com/anastasieste/Anastasi). El estado de publicación se puede consultar en [GitHub Actions](https://github.com/anastasieste/Anastasi/actions).

## Fotografías del carrusel

Guarda los archivos autorizados en `Página WEB/assets/images/carousel/`. Recomendación: WebP o AVIF, proporción horizontal 2:1 y ancho de aproximadamente 1600 px. Las fotografías con otras proporciones se muestran completas con espacio negro, sin recortarlas.

Edita `carouselImages` en `js/data/content.js`:

```js
{
  id: 'foto-001',
  src: 'assets/images/carousel/foto-001.webp',
  title: 'Título confirmado',
  description: 'Descripción de la fotografía',
  alt: 'Descripción útil de lo que muestra la imagen',
  order: 1,
  // Opcional: versiones de menor peso para pantallas pequeñas.
  srcset: 'assets/images/carousel/foto-001-800.webp 800w, assets/images/carousel/foto-001.webp 1600w'
}
```

El carrusel muestra tres encuadres de `GrupalPrueba.jpg`, también visible provisionalmente en Nosotros y Galería. Sustitúyelos cuando lleguen las fotografías oficiales. Ajusta también el enlace `rel="preload"` de `index.html` para precargar la primera fotografía real. No es necesario modificar la lógica del carrusel. La foto de prueba está identificada como provisional en la galería.

El componente admite listas vacías, una sola imagen y múltiples imágenes. Con dos imágenes, la misma vecina aparece en ambos extremos del bucle. Renderiza un máximo de cinco posiciones y precarga las cercanas. El reflejo es una copia visual CSS, nunca una modificación del archivo.

### Velocidad y movimiento

En `carouselSettings`, `interval: 5000` indica los milisegundos de permanencia antes de avanzar y `duration: 850` la duración de la transición. El intervalo se reinicia al terminar cada transición. Se evitan movimientos simultáneos.

Hay flechas, teclado (izquierda/derecha), clic en laterales, arrastre con mouse, gesto táctil y pausa manual. El autoplay se detiene con foco de teclado, durante el arrastre, al ocultar la pestaña o al salir de la pantalla. Mantener el ratón sobre el carrusel permite que siga avanzando. Se desactiva con `prefers-reduced-motion`, conservando navegación manual sin animación.

## Textos y estilo

Edita los textos de las secciones en `index.html`. Los títulos y descripciones del carrusel se editan en `js/data/content.js`. Los colores globales están en `:root` de `css/styles.css`. Se utilizan fuentes del sistema para evitar descargas y servicios externos.

El archivo `assets/images/branding/Chango2.png` es una copia exacta del original, verificada con SHA-256. Los iconos PNG son copias redimensionadas para instalación; el icono maskable añade un margen negro. No se redibujó ni recortó el diseño. No aplicar filtros al logo.

## Escuadrones y galería

El array `squads` permanece vacío hasta disponer de datos oficiales. `galleryItems` contiene la foto grupal provisional. Sus esquemas están documentados en `js/data/content.js`. Añadir objetos crea las tarjetas automáticamente.

Para escuadrones utiliza `id`, `code`, `name`, `badge`, `photo`, `description` y `members: [{ callsign }]`. No incluyas datos personales no destinados a publicación.

En galería utiliza `type: 'photo'` o `'video'`, `src`, `thumbnail`, `title`, `alt`, `callsign`, `squad`, `publishedAt` (AAAA-MM-DD) y `approved: true`. Solo esos registros aprobados se muestran. Los filtros, el visor de fotos y la reproducción de videos están preparados. El visor se cierra con Escape o con su botón. La foto provisional es el único elemento disponible.

**El campo `approved` es una convención de contenido estático, no una barrera de seguridad.** No incluyas material privado o pendiente de aprobación en el repositorio público. Una futura integración deberá filtrar y autorizar en el servidor antes de enviar datos al cliente.

## PWA y actualizaciones

El manifest declara nombre, inicio relativo, colores e iconos. La instalación depende del navegador y requiere HTTPS (o localhost para pruebas). En Safari de iPhone se utiliza la opción de compartir y añadir a la pantalla de inicio.

El Service Worker guarda únicamente HTML, CSS, módulos y manifest. Consulta primero la red y usa la caché si falla la conexión. No guarda imágenes ni videos: sin conexión pueden faltar estos recursos. La página funciona aunque no se registre el Service Worker.

Al publicar cambios, incrementa `VERSION` en `sw.js`. Las actualizaciones esperan al cierre de pestañas anteriores para no forzar una recarga en plena navegación. Las cachés de otras aplicaciones no se eliminan. No existe una promesa de modo offline completo en esta fase.

## Comprobaciones

Con el servidor local activo, abre <http://127.0.0.1:4173/tests/carousel.html>. La página ejecuta pruebas reales del componente con 0, 1, 2, 3 y 7 imágenes: ciclos, navegación inversa, teclado, gestos sintéticos, foco, pausa, autoplay con el ratón sobre el carrusel y movimiento reducido. Mantén esa pestaña visible hasta que muestre el resultado (unos 11 segundos). No se publica con el sitio.

Para comprobar sintaxis y preparar el sitio:

```powershell
node --check "Página WEB/js/app.js"
node --check "Página WEB/js/components/carousel.js"
node --check "Página WEB/js/components/collections.js"
node --check "Página WEB/sw.js"
node scripts/package-pages.mjs
```

Revisa también en dispositivos reales: iPhone/Safari, Android, teclado y movimiento reducido. Las pruebas en un navegador de escritorio con tamaño móvil no sustituyen las pruebas físicas de rendimiento táctil e instalación PWA.

## Siguiente fase

1. Incorporar fotografías autorizadas, escuadrones y enlaces sociales oficiales.
2. Validar la web publicada en dispositivos reales.
3. Diseñar registro y aprobación administrativa, perfiles y permisos antes de implementar acceso privado.
4. Desarrollar el editor multimedia independiente y la integración de contenido aprobado con Drive / Apps Script.

El botón **Portal Miembros** del menú abre un aviso de disponibilidad. No hay autenticación, administración, subida de archivos ni conexión con Drive en esta versión.

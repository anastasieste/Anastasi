// Aumentar VERSION cada vez que cambien los archivos de la estructura.
const VERSION = 'anastasi-v1.1.0';
const CACHE = `${VERSION}-${self.registration.scope}`;
const SHELL = [ './', './index.html', './css/styles.css', './js/app.js', './js/data/content.js', './js/components/carousel.js', './js/components/collections.js', './manifest.webmanifest' ];
const shellURLs = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  // Sin skipWaiting: una actualización se activa cuando se cierran las pestañas anteriores.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('anastasi-') && key.endsWith(`-${self.registration.scope}`) && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  // Fotografías, videos y fuentes externas no se almacenan en caché.
  if (event.request.method !== 'GET' || !shellURLs.has(event.request.url)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(event.request)) || Response.error();
    }
  })());
});

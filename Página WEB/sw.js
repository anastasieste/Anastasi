// Aumentar VERSION cada vez que cambien los archivos de la estructura.
const VERSION = 'anastasi-v1.7.0';
const CACHE = `${VERSION}-${self.registration.scope}`;
const SHELL = [
  './', './index.html', './css/styles.css?v=1.7', './js/app.js?v=1.7', './js/account.js', './js/account.js?v=1.7', './js/member-menu.js',
  './js/data/account-config.js', './js/data/content.js?v=1.2',
  './js/site-navigation.js', './js/components/carousel.js', './js/components/collections.js?v=1.7', './js/video-cover.js', './manifest.webmanifest',
];
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
